#!/usr/bin/env node

/**
 * Session Discovery Utility
 * Find and analyze recording sessions by date, duration, content type, etc.
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

function getAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log('❌ Sessions directory not found');
    return [];
  }

  const entries = fs.readdirSync(SESSIONS_DIR)
    .filter(entry => {
      const fullPath = path.join(SESSIONS_DIR, entry);
      return fs.statSync(fullPath).isDirectory() && entry !== 'archived';
    })
    .map(sessionId => {
      const sessionPath = path.join(SESSIONS_DIR, sessionId);
      const metaPath = path.join(sessionPath, 'meta.json');
      
      let metadata = {};
      if (fs.existsSync(metaPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {
          console.warn(`⚠️  Failed to read metadata for ${sessionId}`);
        }
      }

      // Count actual files
      const framesDir = path.join(sessionPath, 'frames');
      const audioDir = path.join(sessionPath, 'audio', 'chunks');
      const eventsPath = path.join(sessionPath, 'events.ndjson');
      
      const frameCount = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).length : 0;
      const audioCount = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => f.endsWith('.wav')).length : 0;
      const hasEvents = fs.existsSync(eventsPath);
      
      let speechEvents = 0;
      if (hasEvents) {
        try {
          const events = fs.readFileSync(eventsPath, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
          speechEvents = events.filter(e => e.etype === 'speech.final').length;
        } catch (e) {
          console.warn(`⚠️  Failed to parse events for ${sessionId}`);
        }
      }

      return {
        session_id: sessionId,
        session_path: sessionPath,
        metadata,
        stats: {
          frame_count: frameCount,
          audio_chunks: audioCount,
          speech_events: speechEvents,
          has_events: hasEvents,
          size_mb: getDirSize(sessionPath) / (1024 * 1024)
        }
      };
    });

  return entries.sort((a, b) => {
    const timeA = a.metadata.created_timestamp || 0;
    const timeB = b.metadata.created_timestamp || 0;
    return timeB - timeA; // Most recent first
  });
}

function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        totalSize += getDirSize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return totalSize;
}

function filterSessions(sessions, filters = {}) {
  return sessions.filter(session => {
    const meta = session.metadata;
    const stats = session.stats;

    // Date filters
    if (filters.date) {
      if (meta.created_date !== filters.date) return false;
    }
    
    if (filters.after) {
      const sessionDate = new Date(meta.created_at || 0);
      const afterDate = new Date(filters.after);
      if (sessionDate < afterDate) return false;
    }
    
    if (filters.before) {
      const sessionDate = new Date(meta.created_at || 0);
      const beforeDate = new Date(filters.before);
      if (sessionDate > beforeDate) return false;
    }

    // Content filters
    if (filters.hasAudio && stats.audio_chunks === 0) return false;
    if (filters.hasFrames && stats.frame_count === 0) return false;
    if (filters.hasSpeech && stats.speech_events === 0) return false;
    
    // Duration filters
    if (filters.minDuration) {
      const duration = meta.total_duration_ms || 0;
      if (duration < filters.minDuration * 1000) return false;
    }

    return true;
  });
}

function displaySessions(sessions) {
  if (sessions.length === 0) {
    console.log('📭 No sessions found matching criteria');
    return;
  }

  console.log(`\n📊 Found ${sessions.length} sessions:\n`);
  
  sessions.forEach((session, index) => {
    const meta = session.metadata;
    const stats = session.stats;
    const date = meta.created_date || 'Unknown';
    const time = meta.created_time || 'Unknown';
    const duration = meta.total_duration_readable || 'Unknown';
    const status = meta.status || 'Unknown';
    
    console.log(`${index + 1}. ${session.session_id}`);
    console.log(`   📅 Date: ${date} ${time}`);
    console.log(`   ⏱️  Duration: ${duration} (${status})`);
    console.log(`   🎬 Frames: ${stats.frame_count} | 🎤 Audio: ${stats.audio_chunks} | 💬 Speech: ${stats.speech_events}`);
    console.log(`   💾 Size: ${stats.size_mb.toFixed(1)} MB`);
    if (meta.purpose) console.log(`   🎯 Purpose: ${meta.purpose}`);
    console.log(`   📁 Path: ${session.session_path}`);
    console.log('');
  });
}

// CLI Interface
function main() {
  const args = process.argv.slice(2);
  const sessions = getAllSessions();
  
  if (args.length === 0) {
    console.log('🔍 Desktop Vision MVP - Session Discovery');
    displaySessions(sessions.slice(0, 10)); // Show recent 10
    console.log(`\n💡 Use --help for search options`);
    return;
  }

  if (args.includes('--help')) {
    console.log(`
🔍 Desktop Vision MVP - Session Discovery

Usage: node discover-sessions.js [options]

Options:
  --date YYYY-MM-DD     Find sessions from specific date
  --after YYYY-MM-DD    Find sessions after date
  --before YYYY-MM-DD   Find sessions before date
  --has-audio           Only sessions with audio recordings
  --has-frames          Only sessions with screen captures
  --has-speech          Only sessions with speech transcription
  --min-duration N      Minimum duration in seconds
  --all                 Show all sessions (not just recent 10)

Examples:
  node discover-sessions.js --date 2025-08-15
  node discover-sessions.js --has-speech --min-duration 30
  node discover-sessions.js --after 2025-08-14 --has-audio
    `);
    return;
  }

  // Parse filters
  const filters = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date') filters.date = args[i + 1];
    if (arg === '--after') filters.after = args[i + 1];
    if (arg === '--before') filters.before = args[i + 1];
    if (arg === '--has-audio') filters.hasAudio = true;
    if (arg === '--has-frames') filters.hasFrames = true;
    if (arg === '--has-speech') filters.hasSpeech = true;
    if (arg === '--min-duration') filters.minDuration = parseInt(args[i + 1]);
  }

  const filteredSessions = filterSessions(sessions, filters);
  const showAll = args.includes('--all');
  
  displaySessions(showAll ? filteredSessions : filteredSessions.slice(0, 10));
}

if (require.main === module) {
  main();
}

module.exports = { getAllSessions, filterSessions };