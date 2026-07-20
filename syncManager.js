// syncManager.js - Complete Offline-Online Sync System
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const cron = require('node-cron');

class SyncManager {
    constructor() {
        // GitHub repository configuration
        this.repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/your-org/school-management-system.git';
        this.branch = process.env.GIT_BRANCH || 'main';
        this.repoPath = path.join(__dirname, '..', 'git-repo');
        this.dataPath = path.join(__dirname, '..', 'data');
        this.frontendPath = path.join(__dirname, '..', 'public');
        this.backendPath = path.join(__dirname, '..', 'server.js');
        
        this.isOnline = false;
        this.lastSyncTime = null;
        this.syncInProgress = false;
        this.git = null;
        this.fileWatcher = null;
        
        // Files to sync
        this.syncFiles = {
            data: {
                local: this.dataPath,
                remote: path.join(this.repoPath, 'data')
            },
            frontend: {
                local: this.frontendPath,
                remote: path.join(this.repoPath, 'frontend')
            },
            backend: {
                local: this.backendPath,
                remote: path.join(this.repoPath, 'backend', 'server.js')
            }
        };
        
        this._init();
    }

    // ================================================================
    // INITIALIZATION
    // ================================================================
    async _init() {
        console.log('🔄 Initializing Sync Manager...');
        
        // Check if git is installed
        try {
            this.git = simpleGit();
            await this.git.version();
            console.log('✅ Git found');
        } catch (error) {
            console.error('❌ Git not found. Please install git.');
            return;
        }
        
        // Check internet connectivity
        await this._checkConnectivity();
        
        // Initialize or clone repository
        await this._setupRepository();
        
        // Start file watcher
        this._startFileWatcher();
        
        // Schedule auto-sync
        this._scheduleAutoSync();
        
        // Perform initial sync
        setTimeout(() => {
            this.sync();
        }, 3000);
        
        console.log('✅ Sync Manager initialized');
    }

    // ================================================================
    // CONNECTIVITY CHECK
    // ================================================================
    async _checkConnectivity() {
        try {
            const response = await fetch('https://api.github.com', {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000)
            });
            this.isOnline = response.ok;
            console.log(`📶 Network status: ${this.isOnline ? 'Online' : 'Offline'}`);
            return this.isOnline;
        } catch (error) {
            this.isOnline = false;
            console.log('📶 Network status: Offline');
            return false;
        }
    }

    // ================================================================
    // REPOSITORY SETUP
    // ================================================================
    async _setupRepository() {
        const repoExists = await fs.pathExists(this.repoPath);
        
        if (!repoExists) {
            console.log('📦 Cloning repository...');
            try {
                await this.git.clone(this.repoUrl, this.repoPath);
                console.log('✅ Repository cloned successfully');
            } catch (error) {
                console.error('❌ Failed to clone repository:', error.message);
                // Create local repo if clone fails
                await this._createLocalRepo();
            }
        } else {
            console.log('📁 Repository exists, pulling latest...');
            await this._pull();
        }
    }

    async _createLocalRepo() {
        console.log('📁 Creating local repository...');
        await fs.ensureDir(this.repoPath);
        this.git = simpleGit(this.repoPath);
        await this.git.init();
        await this.git.addRemote('origin', this.repoUrl);
        console.log('✅ Local repository created');
    }

    // ================================================================
    // GIT OPERATIONS
    // ================================================================
    async _pull() {
        if (!this.isOnline) {
            console.log('⏭️ Offline, skipping pull');
            return false;
        }
        
        try {
            this.git = simpleGit(this.repoPath);
            await this.git.pull('origin', this.branch);
            console.log('✅ Pulled latest changes');
            return true;
        } catch (error) {
            console.error('❌ Pull failed:', error.message);
            return false;
        }
    }

    async _push() {
        if (!this.isOnline) {
            console.log('⏭️ Offline, skipping push');
            return false;
        }
        
        try {
            this.git = simpleGit(this.repoPath);
            await this.git.add('.');
            await this.git.commit(`Auto-sync: ${new Date().toISOString()}`);
            await this.git.push('origin', this.branch);
            console.log('✅ Pushed changes to remote');
            return true;
        } catch (error) {
            console.error('❌ Push failed:', error.message);
            return false;
        }
    }

    // ================================================================
    // FILE SYNC OPERATIONS
    // ================================================================
    async _syncDataFiles() {
        console.log('📁 Syncing data files...');
        const dataFiles = await fs.readdir(this.dataPath);
        
        for (const file of dataFiles) {
            if (file.endsWith('.json')) {
                const localPath = path.join(this.dataPath, file);
                const remotePath = path.join(this.repoPath, 'data', file);
                
                // Ensure remote directory exists
                await fs.ensureDir(path.dirname(remotePath));
                
                // Read local file
                const localContent = await fs.readFile(localPath, 'utf8');
                let localData = JSON.parse(localContent);
                let remoteData = {};
                let shouldPush = true;
                
                // Check if remote file exists
                if (await fs.pathExists(remotePath)) {
                    const remoteContent = await fs.readFile(remotePath, 'utf8');
                    remoteData = JSON.parse(remoteContent);
                    
                    // Check if files are different
                    if (JSON.stringify(localData) === JSON.stringify(remoteData)) {
                        shouldPush = false;
                    } else {
                        // Resolve conflicts
                        localData = await this._resolveConflict(localData, remoteData, file);
                    }
                }
                
                if (shouldPush) {
                    // Write merged data to remote
                    await fs.writeJson(remotePath, localData, { spaces: 2 });
                    console.log(`  ✅ Synced: ${file}`);
                } else {
                    console.log(`  ⏭️ No changes: ${file}`);
                }
            }
        }
    }

    async _syncFrontendFiles() {
        console.log('📁 Syncing frontend files...');
        const frontendFiles = ['main.js', 'index.html', 'styles.css'];
        
        for (const file of frontendFiles) {
            const localPath = path.join(this.frontendPath, file);
            const remotePath = path.join(this.repoPath, 'frontend', file);
            
            if (await fs.pathExists(localPath)) {
                await fs.ensureDir(path.dirname(remotePath));
                await fs.copy(localPath, remotePath, { overwrite: true });
                console.log(`  ✅ Synced: ${file}`);
            }
        }
    }

    async _syncBackendFile() {
        console.log('📁 Syncing backend file...');
        const localPath = this.backendPath;
        const remotePath = path.join(this.repoPath, 'backend', 'server.js');
        
        if (await fs.pathExists(localPath)) {
            await fs.ensureDir(path.dirname(remotePath));
            await fs.copy(localPath, remotePath, { overwrite: true });
            console.log('  ✅ Synced: server.js');
        }
    }

    // ================================================================
    // CONFLICT RESOLUTION
    // ================================================================
    async _resolveConflict(localData, remoteData, fileName) {
        console.log(`⚠️ Conflict detected in ${fileName}`);
        
        // For student records, merge by ID
        if (fileName === 'students.json') {
            return this._mergeStudents(localData, remoteData);
        }
        
        // For payments, merge by ID
        if (fileName === 'feePayments.json') {
            return this._mergeById(localData, remoteData);
        }
        
        // For general data, merge by ID
        return this._mergeById(localData, remoteData);
    }

    _mergeStudents(localStudents, remoteStudents) {
        const merged = [];
        const studentMap = new Map();
        
        // Add remote students first
        for (const student of remoteStudents) {
            studentMap.set(student.id, { ...student });
        }
        
        // Merge local students
        for (const student of localStudents) {
            if (studentMap.has(student.id)) {
                // Merge local changes with remote
                const remote = studentMap.get(student.id);
                const mergedStudent = {
                    ...remote,
                    ...student,
                    updatedAt: new Date().toISOString(),
                    // Preserve both remote and local customizations
                    customItemOverrides: {
                        ...(remote.customItemOverrides || {}),
                        ...(student.customItemOverrides || {})
                    },
                    removedItems: {
                        ...(remote.removedItems || {}),
                        ...(student.removedItems || {})
                    }
                };
                studentMap.set(student.id, mergedStudent);
            } else {
                // New local student
                studentMap.set(student.id, { ...student });
            }
        }
        
        return Array.from(studentMap.values());
    }

    _mergeById(localData, remoteData) {
        const merged = [];
        const dataMap = new Map();
        
        // Add remote data first
        for (const item of remoteData) {
            if (item.id) {
                dataMap.set(item.id, { ...item });
            }
        }
        
        // Add/merge local data
        for (const item of localData) {
            if (item.id && dataMap.has(item.id)) {
                const remote = dataMap.get(item.id);
                dataMap.set(item.id, { ...remote, ...item, updatedAt: new Date().toISOString() });
            } else if (item.id) {
                dataMap.set(item.id, { ...item });
            } else {
                // No ID, treat as new
                merged.push({ ...item });
            }
        }
        
        return [...merged, ...Array.from(dataMap.values())];
    }

    // ================================================================
    // MAIN SYNC FUNCTION
    // ================================================================
    async sync() {
        if (this.syncInProgress) {
            console.log('⏭️ Sync already in progress');
            return;
        }
        
        console.log('🔄 Starting sync...');
        this.syncInProgress = true;
        
        try {
            // Check connectivity
            await this._checkConnectivity();
            
            if (this.isOnline) {
                // Pull latest changes
                await this._pull();
                
                // Sync local -> remote
                await this._syncDataFiles();
                await this._syncFrontendFiles();
                await this._syncBackendFile();
                
                // Push changes
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
        }
    }

    // ================================================================
    // FILE WATCHER
    // ================================================================
    _startFileWatcher() {
        console.log('👁️ Starting file watcher...');
        
        const watchPaths = [
            this.dataPath,
            this.frontendPath,
            this.backendPath
        ];
        
        this.fileWatcher = chokidar.watch(watchPaths, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });
        
        this.fileWatcher
            .on('change', (filePath) => {
                console.log(`📝 File changed: ${filePath}`);
                // Debounce: wait 3 seconds before syncing
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    this.sync();
                }, 3000);
            })
            .on('add', (filePath) => {
                console.log(`➕ File added: ${filePath}`);
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    this.sync();
                }, 3000);
            })
            .on('unlink', (filePath) => {
                console.log(`➖ File removed: ${filePath}`);
                clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => {
                    this.sync();
                }, 3000);
            });
            
        console.log('✅ File watcher started');
    }

    // ================================================================
    // AUTO-SYNC SCHEDULER
    // ================================================================
    _scheduleAutoSync() {
        console.log('⏰ Scheduling auto-sync...');
        
        // Sync every 5 minutes
        cron.schedule('*/5 * * * *', () => {
            console.log('⏰ Scheduled sync triggered');
            this.sync();
        });
        
        // Also sync at startup and every hour
        cron.schedule('0 * * * *', () => {
            console.log('⏰ Hourly sync triggered');
            this.sync();
        });
        
        console.log('✅ Auto-sync scheduled');
    }

    // ================================================================
    // MANUAL SYNC TRIGGER
    // ================================================================
    async forceSync() {
        console.log('🔄 Force sync triggered');
        await this._pull();
        await this._syncDataFiles();
        await this._syncFrontendFiles();
        await this._syncBackendFile();
        await this._push();
        console.log('✅ Force sync completed');
    }

    // ================================================================
    // STATUS CHECK
    // ================================================================
    getStatus() {
        return {
            isOnline: this.isOnline,
            lastSyncTime: this.lastSyncTime,
            syncInProgress: this.syncInProgress,
            repoPath: this.repoPath,
            dataPath: this.dataPath,
            frontendPath: this.frontendPath,
            backendPath: this.backendPath
        };
    }
}

module.exports = SyncManager;