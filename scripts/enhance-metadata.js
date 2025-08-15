#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function enhanceMetadata(sessionDir) {
    const metaPath = path.join(sessionDir, 'meta.json');
    const eventsPath = path.join(sessionDir, 'events.ndjson');
    const framesDir = path.join(sessionDir, 'frames');
    
    // Read existing metadata or create new
    let meta = {};
    if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
    
    // Read events for analysis
    let events = [];
    if (fs.existsSync(eventsPath)) {
        const eventsText = fs.readFileSync(eventsPath, 'utf8');
        events = eventsText.trim().split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
    }
    
    // Count frames
    let frameCount = 0;
    if (fs.existsSync(framesDir)) {
        frameCount = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).length;
    }
    
    // Analyze speech events
    const speechEvents = events.filter(e => e.etype === 'speech.final');
    const allSpeechText = speechEvents.map(e => e.text).join(' ').toLowerCase();
    
    // Extract key topics and generate summary
    const topics = extractTopics(allSpeechText);
    const summary = generateSummary(speechEvents, topics);
    const friendlyName = generateFriendlyName(topics, speechEvents);
    
    // Calculate session duration
    const timestamps = events.map(e => e.t).filter(t => t);
    const duration = timestamps.length > 0 ? 
        Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60000) : 0;
    
    // Enhanced metadata
    const enhanced = {
        ...meta,
        session_id: path.basename(sessionDir),
        friendly_name: friendlyName,
        enhanced_at: new Date().toISOString(),
        duration_mins: duration,
        stats: {
            total_events: events.length,
            frame_count: frameCount,
            speech_events: speechEvents.length,
            unique_words: countUniqueWords(allSpeechText)
        },
        topics: topics,
        summary: summary,
        key_moments: extractKeyMoments(speechEvents)
    };
    
    // Save enhanced metadata
    fs.writeFileSync(metaPath, JSON.stringify(enhanced, null, 2));
    console.log(`✅ Enhanced metadata saved: ${metaPath}`);
    console.log(`   Friendly name: ${friendlyName}`);
    console.log(`   Duration: ${duration} minutes`);
    console.log(`   Topics: ${topics.join(', ')}`);
    
    return enhanced;
}

function extractTopics(text) {
    const topicKeywords = {
        'ui-layout': ['layout', 'ui', 'interface', 'design', 'screen', 'window'],
        'terminal': ['terminal', 'command', 'shell', 'console'],
        'fullscreen': ['fullscreen', 'full screen', 'maximize', 'window size'],
        'positioning': ['bottom', 'top', 'left', 'right', 'move', 'position'],
        'testing': ['test', 'check', 'verify', 'see', 'show'],
        'development': ['program', 'application', 'app', 'code', 'build']
    };
    
    const foundTopics = [];
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            foundTopics.push(topic);
        }
    }
    
    return foundTopics.length > 0 ? foundTopics : ['general'];
}

function generateSummary(speechEvents, topics) {
    if (speechEvents.length === 0) return 'Session with no recorded speech';
    
    const wordCount = speechEvents.reduce((sum, e) => sum + e.text.split(' ').length, 0);
    const topicList = topics.join(', ');
    
    return `${speechEvents.length} speech events covering ${topicList}. ${wordCount} words total.`;
}

function generateFriendlyName(topics, speechEvents) {
    if (topics.length === 0) return 'General Session';
    
    const topicMap = {
        'ui-layout': 'UI Layout',
        'terminal': 'Terminal',
        'fullscreen': 'Fullscreen',
        'positioning': 'Positioning',
        'testing': 'Testing',
        'development': 'Development'
    };
    
    const mainTopic = topics[0];
    const readableTopics = topics.slice(0, 2).map(t => topicMap[t] || t);
    
    if (speechEvents.length > 0) {
        return `${readableTopics.join(' & ')} Discussion`;
    }
    
    return `${readableTopics.join(' & ')} Session`;
}

function extractKeyMoments(speechEvents) {
    // Find longer speech segments that might be important
    return speechEvents
        .filter(e => e.text.split(' ').length > 5) // More than 5 words
        .slice(0, 3) // Top 3
        .map(e => ({
            timestamp: e.t,
            text: e.text.substring(0, 100) + (e.text.length > 100 ? '...' : ''),
            word_count: e.text.split(' ').length
        }));
}

function countUniqueWords(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return new Set(words).size;
}

// Process session if called directly
if (require.main === module) {
    const sessionPath = process.argv[2];
    
    if (sessionPath) {
        // Process specific session
        console.log(`Enhancing metadata for: ${path.basename(sessionPath)}`);
        enhanceMetadata(sessionPath);
    } else {
        // Process most recent session
        const sessionsRoot = path.join(__dirname, '..', 'sessions');
        const sessions = fs.readdirSync(sessionsRoot)
            .filter(d => d.match(/^\d{4}-\d{2}-\d{2}T/) || d.match(/^session-/))
            .map(d => path.join(sessionsRoot, d))
            .filter(d => fs.statSync(d).isDirectory())
            .sort((a, b) => b.localeCompare(a)); // Most recent first
        
        if (sessions.length > 0) {
            console.log(`Enhancing metadata for: ${path.basename(sessions[0])}`);
            enhanceMetadata(sessions[0]);
        } else {
            console.log('No sessions found');
        }
    }
}

module.exports = { enhanceMetadata };