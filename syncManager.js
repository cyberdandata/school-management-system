// syncManager.js - COMPLETE REBUILT v2.0
// Full bidirectional sync with conflict resolution
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');

class SyncManager {
    constructor() {
        this.repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/cyberdandata/school-management-system.git';
        this.branch = process.env.GIT_BRANCH || 'main';
        this.repoPath = path.join(__dirname, 'git-repo');
        this.dataPath = path.join(__dirname, 'data');
        this.frontendPath = path.join(__dirname, 'public');
        this.backendPath = path.join(__dirname, 'server.js');
        this.isOnline = false;
        this.lastSyncTime = null;
        this.syncInProgress = false;
        this.git = null;
        this.fileWatcher = null;
        this._debounceTimer = null;
        this._syncQueue = [];
        this._isProcessingQueue = false;
        
        this._init();
    }

    async _init() {
        console.log('🔄 Initializing Sync Manager v2.0...');
        try {
            this.git = simpleGit();
            await this.git.version();
            console.log('✅ Git found');
        } catch (error) {
            console.error('❌ Git not found. Please install git.');
            return;
        }
        
        await this._checkConnectivity();
        await this._setupRepository();
        await this._startFileWatcher();
        this._scheduleAutoSync();
        
        setTimeout(() => this.sync(), 3000);
        console.log('✅ Sync Manager initialized');
    }

    async _checkConnectivity() {
        try {
            const response = await fetch('https://api.github.com', { 
                method: 'HEAD', 
                signal: AbortSignal.timeout(5000) 
            });
            this.isOnline = response.ok;
            console.log(`📶 Network: ${this.isOnline ? 'Online' : 'Offline'}`);
            return this.isOnline;
        } catch {
            this.isOnline = false;
            console.log('📶 Network: Offline');
            return false;
        }
    }

    async _setupRepository() {
        if (await fs.pathExists(this.repoPath)) {
            console.log('📁 Repository exists, pulling latest...');
            await this._pull();
        } else {
            console.log('📦 Cloning repository...');
            try {
                await this.git.clone(this.repoUrl, this.repoPath);
                console.log('✅ Repository cloned');
            } catch (error) {
                console.log('⚠️ Clone failed, creating local repo...');
                await fs.ensureDir(this.repoPath);
                this.git = simpleGit(this.repoPath);
                await this.git.init();
                await this.git.addRemote('origin', this.repoUrl);
                console.log('✅ Local repository created');
            }
        }
    }

    // ================================================================
    // PULL with conflict resolution
    // ================================================================
    async _pull() {
        if (!this.isOnline) return false;
        try {
            this.git = simpleGit(this.repoPath);
            
            // Fetch latest changes
            await this.git.fetch('origin', this.branch);
            
            // Check if there are remote changes
            const status = await this.git.status();
            const behind = status.behind || 0;
            
            if (behind > 0) {
                console.log(`📥 ${behind} commits behind, pulling...`);
                await this.git.pull('origin', this.branch, ['--rebase']);
                console.log('✅ Pulled latest changes');
                return true;
            } else {
                console.log('📥 Already up to date');
                return true;
            }
        } catch (error) {
            console.error('❌ Pull failed:', error.message);
            try {
                console.log('🔄 Attempting reset...');
                await this.git.reset(['--hard', `origin/${this.branch}`]);
                console.log('✅ Reset to origin/main');
                return true;
            } catch (resetError) {
                console.error('❌ Reset failed:', resetError.message);
                return false;
            }
        }
    }

    // ================================================================
    // PUSH with conflict check
    // ================================================================
    async _push() {
        if (!this.isOnline) return false;
        try {
            this.git = simpleGit(this.repoPath);
            
            const status = await this.git.status();
            const hasChanges = status.files && status.files.length > 0;
            
            if (!hasChanges) {
                console.log('📝 No changes to commit');
                return true;
            }
            
            await this.git.add('.');
            const commitMsg = `Auto-sync: ${new Date().toISOString()}`;
            await this.git.commit(commitMsg);
            console.log(`📝 Committed: ${commitMsg}`);
            
            await this._pull();
            await this.git.push('origin', this.branch);
            console.log('✅ Pushed changes');
            return true;
        } catch (error) {
            console.error('❌ Push failed:', error.message);
            try {
                console.log('🔄 Trying force with lease...');
                await this.git.push('origin', this.branch, ['--force-with-lease']);
                console.log('✅ Force pushed changes');
                return true;
            } catch (forceError) {
                console.error('❌ Force push failed:', forceError.message);
                return false;
            }
        }
    }

    // ================================================================
    // MAIN SYNC - Bidirectional with file comparison
    // ================================================================
    async sync() {
        if (this.syncInProgress) {
            console.log('⏭️ Sync already in progress');
            return;
        }
        
        console.log('🔄 Starting sync...');
        this.syncInProgress = true;
        
        try {
            await this._checkConnectivity();
            if (this.isOnline) {
                // 1. Pull latest changes FIRST
                await this._pull();
                
                // 2. Sync data files (bidirectional)
                await this._syncDataFiles();
                
                // 3. Sync frontend files
                await this._syncFrontendFiles();
                
                // 4. Sync backend file
                await this._syncBackendFile();
                
                // 5. Push changes if any
                await this._push();
                
                this.lastSyncTime = new Date();
                console.log(`✅ Sync completed at ${this.lastSyncTime.toISOString()}`);
            } else {
                console.log('⏭️ Offline, sync skipped');
            }
        } catch (error) {
            console.error('❌ Sync failed:', error.message);
        } finally {
            this.syncInProgress = false;
            if (this._syncQueue.length > 0) {
                this._syncQueue.shift();
                setTimeout(() => this.sync(), 1000);
            }
        }
    }

    // ================================================================
    // FIXED: Bidirectional Data Sync with file comparison
    // ================================================================
    async _syncDataFiles() {
        console.log('📁 Syncing data files...');
        const files = await fs.readdir(this.dataPath);
        
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const localPath = path.join(this.dataPath, file);
            const remotePath = path.join(this.repoPath, 'data', file);
            await fs.ensureDir(path.dirname(remotePath));
            
            try {
                const localExists = await fs.pathExists(localPath);
                const remoteExists = await fs.pathExists(remotePath);
                
                if (!localExists && !remoteExists) continue;
                
                if (!localExists && remoteExists) {
                    // Remote exists, local doesn't → copy remote to local
                    await fs.copy(remotePath, localPath);
                    console.log(`  ✅ Pulled (new): ${file}`);
                    continue;
                }
                
                if (localExists && !remoteExists) {
                    // Local exists, remote doesn't → copy local to remote
                    await fs.copy(localPath, remotePath);
                    console.log(`  ✅ Pushed (new): ${file}`);
                    continue;
                }
                
                // Both exist → compare content
                const localContent = await fs.readFile(localPath, 'utf8');
                const remoteContent = await fs.readFile(remotePath, 'utf8');
                
                if (localContent === remoteContent) {
                    console.log(`  ⏭️ No changes: ${file}`);
                    continue;
                }
                
                // Files differ → determine which is newer
                const localStat = await fs.stat(localPath);
                const remoteStat = await fs.stat(remotePath);
                
                if (remoteStat.mtime > localStat.mtime) {
                    // Remote is newer → copy remote to local
                    await fs.copy(remotePath, localPath, { overwrite: true });
                    console.log(`  ✅ Pulled: ${file} (remote newer)`);
                } else {
                    // Local is newer → copy local to remote
                    await fs.copy(localPath, remotePath, { overwrite: true });
                    console.log(`  ✅ Pushed: ${file} (local newer)`);
                }
            } catch (error) {
                console.error(`  ❌ Error syncing ${file}:`, error.message);
            }
        }
    }

    // ================================================================
    // FRONTEND SYNC
    // ================================================================
    async _syncFrontendFiles() {
        console.log('📁 Syncing frontend files...');
        const remotePublicPath = path.join(this.repoPath, 'public');
        
        try {
            await fs.ensureDir(remotePublicPath);
            
            // Check if there are changes
            const localFiles = await fs.readdir(this.frontendPath);
            let hasChanges = false;
            
            for (const file of localFiles) {
                if (['node_modules', '.git', '.DS_Store'].includes(file)) continue;
                
                const localPath = path.join(this.frontendPath, file);
                const remotePath = path.join(remotePublicPath, file);
                
                const stat = await fs.stat(localPath);
                if (stat.isDirectory()) continue;
                
                if (await fs.pathExists(remotePath)) {
                    const localContent = await fs.readFile(localPath, 'utf8');
                    const remoteContent = await fs.readFile(remotePath, 'utf8');
                    if (localContent !== remoteContent) {
                        hasChanges = true;
                        await fs.copy(localPath, remotePath, { overwrite: true });
                        console.log(`  ✅ Synced: ${file}`);
                    }
                } else {
                    hasChanges = true;
                    await fs.copy(localPath, remotePath, { overwrite: true });
                    console.log(`  ✅ Synced (new): ${file}`);
                }
            }
            
            if (!hasChanges) {
                console.log('  ⏭️ No frontend changes');
            }
        } catch (error) {
            console.error('  ❌ Failed to sync public folder:', error.message);
        }
    }

    // ================================================================
    // BACKEND SYNC
    // ================================================================
    async _syncBackendFile() {
        console.log('📁 Syncing backend file...');
        const remotePath = path.join(this.repoPath, 'backend', 'server.js');
        
        try {
            await fs.ensureDir(path.dirname(remotePath));
            
            const localExists = await fs.pathExists(this.backendPath);
            const remoteExists = await fs.pathExists(remotePath);
            
            if (!localExists && !remoteExists) {
                console.log('  ⏭️ No backend file');
                return;
            }
            
            if (!localExists && remoteExists) {
                await fs.copy(remotePath, this.backendPath);
                console.log('  ✅ Pulled: server.js (remote exists)');
                return;
            }
            
            if (localExists && !remoteExists) {
                await fs.copy(this.backendPath, remotePath);
                console.log('  ✅ Pushed: server.js (local exists)');
                return;
            }
            
            // Both exist → compare
            const localContent = await fs.readFile(this.backendPath, 'utf8');
            const remoteContent = await fs.readFile(remotePath, 'utf8');
            
            if (localContent === remoteContent) {
                console.log('  ⏭️ No changes: server.js');
                return;
            }
            
            // Files differ → determine which is newer
            const localStat = await fs.stat(this.backendPath);
            const remoteStat = await fs.stat(remotePath);
            
            if (remoteStat.mtime > localStat.mtime) {
                await fs.copy(remotePath, this.backendPath, { overwrite: true });
                console.log('  ✅ Pulled: server.js (remote newer)');
            } else {
                await fs.copy(this.backendPath, remotePath, { overwrite: true });
                console.log('  ✅ Pushed: server.js (local newer)');
            }
        } catch (error) {
            console.error('  ❌ Failed to sync backend file:', error.message);
        }
    }

    // ================================================================
    // FORCE SYNC
    // ================================================================
    async forceSync() {
        console.log('🔄 Force sync triggered');
        await this.sync();
    }

    // ================================================================
    // FILE WATCHER
    // ================================================================
    async _startFileWatcher() {
        console.log('👁️ Starting file watcher...');
        try {
            const chokidar = await import('chokidar');
            
            const watchPaths = [
                this.dataPath,
                this.frontendPath,
                this.backendPath
            ];
            
            this.fileWatcher = chokidar.watch(watchPaths, {
                ignored: /(^|[\/\\])\..|node_modules/,
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 100 }
            });
            
            this.fileWatcher.on('change', (filePath) => {
                console.log(`📝 File changed: ${filePath}`);
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    console.log('🔄 Queueing sync due to file change...');
                    this._queueSync();
                }, 3000);
            });
            
            this.fileWatcher.on('add', (filePath) => {
                console.log(`➕ File added: ${filePath}`);
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    console.log('🔄 Queueing sync due to file add...');
                    this._queueSync();
                }, 3000);
            });
            
            console.log('✅ File watcher started');
        } catch (error) {
            console.warn('⚠️ File watcher not available:', error.message);
        }
    }

    // ================================================================
    // QUEUE SYSTEM
    // ================================================================
    _queueSync() {
        if (!this._syncQueue.includes('pending')) {
            this._syncQueue.push('pending');
        }
        if (!this._isProcessingQueue && !this.syncInProgress) {
            this._processQueue();
        }
    }

    async _processQueue() {
        if (this._isProcessingQueue) return;
        this._isProcessingQueue = true;
        
        while (this._syncQueue.length > 0) {
            this._syncQueue.shift();
            await this.sync();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        this._isProcessingQueue = false;
    }

    // ================================================================
    // AUTO-SYNC SCHEDULE
    // ================================================================
    _scheduleAutoSync() {
        console.log('⏰ Scheduling auto-sync...');
        cron.schedule('*/5 * * * *', () => {
            console.log('⏰ Scheduled sync triggered');
            this._queueSync();
        });
        console.log('✅ Auto-sync scheduled');
    }

    // ================================================================
    // STATUS
    // ================================================================
    getStatus() {
        return {
            isOnline: this.isOnline,
            lastSyncTime: this.lastSyncTime,
            syncInProgress: this.syncInProgress,
            queueLength: this._syncQueue.length
        };
    }
}

module.exports = SyncManager;