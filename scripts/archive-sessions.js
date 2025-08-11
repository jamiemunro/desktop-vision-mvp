#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
const ARCHIVE_DIR = path.join(SESSIONS_DIR, 'archived');
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    console.log('Created archive directory:', ARCHIVE_DIR);
}

async function compressDirectory(sourcePath, archivePath) {
    return new Promise((resolve, reject) => {
        const tar = spawn('tar', ['-czf', archivePath, '-C', path.dirname(sourcePath), path.basename(sourcePath)]);
        
        tar.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`tar process exited with code ${code}`));
            }
        });
        
        tar.on('error', reject);
    });
}

function getSessionAge(sessionDir) {
    const metaPath = path.join(sessionDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
        // Fallback to directory modification time
        const stats = fs.statSync(sessionDir);
        return Date.now() - stats.mtime.getTime();
    }
    
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        return Date.now() - meta.started_at;
    } catch (error) {
        // Fallback to directory modification time
        const stats = fs.statSync(sessionDir);
        return Date.now() - stats.mtime.getTime();
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getDirSize(dirPath) {
    let totalSize = 0;
    
    function calculateSize(currentPath) {
        const stats = fs.statSync(currentPath);
        if (stats.isDirectory()) {
            const files = fs.readdirSync(currentPath);
            for (const file of files) {
                calculateSize(path.join(currentPath, file));
            }
        } else {
            totalSize += stats.size;
        }
    }
    
    calculateSize(dirPath);
    return totalSize;
}

async function archiveSessions() {
    console.log('🗂️  Scanning sessions for archiving...');
    
    const sessions = fs.readdirSync(SESSIONS_DIR)
        .filter(name => name.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/))
        .map(name => path.join(SESSIONS_DIR, name))
        .filter(sessionPath => fs.statSync(sessionPath).isDirectory());
    
    console.log(`Found ${sessions.length} sessions to check`);
    
    let archived = 0;
    let totalSaved = 0;
    
    for (const sessionPath of sessions) {
        const sessionName = path.basename(sessionPath);
        const age = getSessionAge(sessionPath);
        
        if (age > ONE_DAY_MS) {
            const originalSize = getDirSize(sessionPath);
            const archivePath = path.join(ARCHIVE_DIR, `${sessionName}.tar.gz`);
            
            // Skip if already archived
            if (fs.existsSync(archivePath)) {
                console.log(`⏭️  Skipping ${sessionName} - already archived`);
                continue;
            }
            
            console.log(`📦 Compressing ${sessionName} (${formatBytes(originalSize)}, age: ${Math.round(age / (60 * 60 * 1000))}h)`);
            
            try {
                await compressDirectory(sessionPath, archivePath);
                
                const compressedSize = fs.statSync(archivePath).size;
                const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
                
                console.log(`✅ Compressed to ${formatBytes(compressedSize)} (${compressionRatio}% reduction)`);
                
                // Verify the archive was created successfully before removing original
                if (fs.existsSync(archivePath) && fs.statSync(archivePath).size > 0) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`🗑️  Removed original directory`);
                    archived++;
                    totalSaved += (originalSize - compressedSize);
                } else {
                    console.error(`❌ Archive verification failed for ${sessionName}`);
                }
                
            } catch (error) {
                console.error(`❌ Failed to compress ${sessionName}:`, error.message);
            }
        } else {
            const hoursLeft = Math.round((ONE_DAY_MS - age) / (60 * 60 * 1000));
            console.log(`⏳ ${sessionName} is ${hoursLeft}h away from archiving`);
        }
    }
    
    console.log(`\n📊 Archive Summary:`);
    console.log(`   • Archived: ${archived} sessions`);
    console.log(`   • Space saved: ${formatBytes(totalSaved)}`);
    
    if (archived > 0) {
        console.log(`\n💡 To extract an archive: tar -xzf archived/SESSION_NAME.tar.gz`);
    }
}

// Run the archiving process
archiveSessions().catch(console.error);