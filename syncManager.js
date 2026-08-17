// syncManager.js - DEVELOPER VERSION v5.0
// Pushes code to GitHub, excludes data files
// Use this on the developer's computer

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
        
        // Exclude all data files
        this.excludePatterns = [
            /^data\//,
            /\.json$/,
            /\.csv$/,
            /\.xlsx$/,
            /node_modules/,
            /\.git/
        ];
        
        this._init();
    }

    async _init() {
        console.log('🔄 Initializing Sync Manager v5.0 (Developer - Push Code Only)');
        console.log('📁 Data files will NOT be pushed to GitHub');
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
        console.log('✅ Sync Manager initialized (Developer)');
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
                await this._cleanRemoteDataFolder();
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

    async _cleanRemoteDataFolder() {
        try {
            const remoteDataPath = path.join(this.repoPath, 'data');
            if (await fs.pathExists(remoteDataPath)) {
                await fs.remove(remoteDataPath);
                console.log('  🗑️ Removed data folder from repo');
            }
            const files = await fs.readdir(this.repoPath);
            for (const file of files) {
                if (file.endsWith('.json') && file !== 'package.json' && file !== 'package-lock.json') {
                    await fs.remove(path.join(this.repoPath, file));
                    console.log(`  🗑️ Removed ${file} from repo`);
                }
            }
        } catch (error) {
            console.warn('  ⚠️ Could not clean remote data folder:', error.message);
        }
    }

    // ================================================================
    // PULL (with data exclusion)
    // ================================================================
    async _pull() {
        if (!this.isOnline) return false;
        try {
            this.git = simpleGit(this.repoPath);
            await this.git.fetch('origin', this.branch);
            const status = await this.git.status();
            const behind = status.behind || 0;
            if (behind > 0) {
                console.log(`📥 ${behind} commits behind, pulling...`);
                await this.git.pull('origin', this.branch, ['--rebase']);
                console.log('✅ Pulled latest changes');
                await this._cleanRemoteDataFolder();
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
                await this._cleanRemoteDataFolder();
                return true;
            } catch (resetError) {
                console.error('❌ Reset failed:', resetError.message);
                return false;
            }
        }
    }

    // ================================================================
    // PUSH – EXCLUDES DATA FILES
    // ================================================================
    async _push() {
        if (!this.isOnline) return false;
        try {
            this.git = simpleGit(this.repoPath);
            
            // Check status, filter out data files
            const status = await this.git.status();
            const hasChanges = status.files && status.files.some(f => !this._shouldExclude(f.path));
            
            if (!hasChanges) {
                console.log('📝 No code changes to commit');
                return true;
            }
            
            // Add only code files
            console.log('📝 Adding code files (data excluded)...');
            await this.git.add('.');
            const commitMsg = `Developer sync: ${new Date().toISOString()}`;
            await this.git.commit(commitMsg);
            console.log(`📝 Committed: ${commitMsg}`);
            
            // Pull before push to avoid conflicts
            await this._pull();
            await this.git.push('origin', this.branch);
            console.log('✅ Pushed changes (data excluded)');
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
    // SYNC – BIDIRECTIONAL BUT DATA EXCLUDED
    // ================================================================
    async sync() {
        if (this.syncInProgress) {
            console.log('⏭️ Sync already in progress');
            return;
        }
        
        console.log('🔄 Starting sync (Developer)...');
        this.syncInProgress = true;
        
        try {
            await this._checkConnectivity();
            if (this.isOnline) {
                // 1. Pull latest changes
                await this._pull();
                
                // 2. Sync local code changes to repo (data excluded)
                await this._syncLocalToRemote();
                
                // 3. Push changes
                await this._push();
                
                this.lastSyncTime = new Date();
                console.log(`✅ Sync completed at ${this.lastSyncTime.toISOString()}`);
                console.log('📁 Data files remain LOCAL ONLY');
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
    // COPY LOCAL CODE CHANGES TO REPO (exclude data)
    // ================================================================
    async _syncLocalToRemote() {
        console.log('📁 Syncing local code to repo (data excluded)...');
        
        // 1. Sync frontend files
        const remotePublicPath = path.join(this.repoPath, 'public');
        await fs.ensureDir(remotePublicPath);
        const publicFiles = await fs.readdir(this.frontendPath);
        for (const file of publicFiles) {
            if (this._shouldExclude(file)) continue;
            if (['node_modules', '.git', '.DS_Store'].includes(file)) continue;
            const src = path.join(this.frontendPath, file);
            const dest = path.join(remotePublicPath, file);
            const stat = await fs.stat(src);
            if (stat.isDirectory()) {
                await fs.copy(src, dest, { overwrite: true });
            } else {
                await fs.copy(src, dest, { overwrite: true });
            }
            console.log(`  ✅ Copied: ${file}`);
        }
        
        // 2. Sync backend file
        const remoteBackendPath = path.join(this.repoPath, 'backend', 'server.js');
        await fs.ensureDir(path.dirname(remoteBackendPath));
        await fs.copy(this.backendPath, remoteBackendPath, { overwrite: true });
        console.log('  ✅ Copied: server.js');
        
        // 3. Also copy syncManager.js itself if changed (for updates)
        const syncMgrSrc = path.join(__dirname, 'syncManager.js');
        const syncMgrDest = path.join(this.repoPath, 'syncManager.js');
        if (await fs.pathExists(syncMgrSrc)) {
            await fs.copy(syncMgrSrc, syncMgrDest, { overwrite: true });
            console.log('  ✅ Copied: syncManager.js');
        }
    }

    // ================================================================
    // CHECK IF FILE SHOULD BE EXCLUDED
    // ================================================================
    _shouldExclude(filePath) {
        for (const pattern of this.excludePatterns) {
            if (pattern.test(filePath)) {
                return true;
            }
        }
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (normalizedPath.includes('/data/')) {
            return true;
        }
        return false;
    }

    // ================================================================
    // FILE WATCHER – PUSH ON CODE CHANGES
    // ================================================================
    async _startFileWatcher() {
        console.log('👁️ Starting file watcher (Developer)...');
        try {
            const chokidar = await import('chokidar');
            const watchPaths = [
                this.frontendPath,
                this.backendPath,
                __filename  // watch syncManager.js itself
            ];
            
            this.fileWatcher = chokidar.watch(watchPaths, {
                ignored: /(^|[\/\\])\..|node_modules|\.json$|\.csv$|\.xlsx$/,
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 100 }
            });
            
            this.fileWatcher.on('change', (filePath) => {
                if (this._shouldExclude(filePath)) {
                    console.log(`📝 Data file changed (ignored): ${filePath}`);
                    return;
                }
                console.log(`📝 Code changed: ${filePath}`);
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    console.log('🔄 Queueing sync due to code change...');
                    this._queueSync();
                }, 3000);
            });
            
            console.log('✅ File watcher started (Developer)');
        } catch (error) {
            console.warn('⚠️ File watcher not available:', error.message);
        }
    }

    // ================================================================
    // QUEUE & SCHEDULE
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

    _scheduleAutoSync() {
        console.log('⏰ Scheduling auto-sync...');
        cron.schedule('*/5 * * * *', () => {
            console.log('⏰ Scheduled sync triggered');
            this._queueSync();
        });
        console.log('✅ Auto-sync scheduled');
    }

    async forceSync() {
        console.log('🔄 Force sync triggered');
        await this.sync();
    }

    getStatus() {
        return {
            isOnline: this.isOnline,
            lastSyncTime: this.lastSyncTime,
            syncInProgress: this.syncInProgress,
            queueLength: this._syncQueue.length,
            mode: 'DEVELOPER (Push Code Only)',
            dataSync: 'LOCAL ONLY'
        };
    }
}

module.exports = SyncManager;