#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function correlateTimeline(sessionDir) {
    const eventsPath = path.join(sessionDir, 'events.ndjson');
    const framesDir = path.join(sessionDir, 'frames');
    const outputPath = path.join(sessionDir, 'timeline-correlated.json');
    
    if (!fs.existsSync(eventsPath)) {
        console.log(`No events file found: ${eventsPath}`);
        return;
    }
    
    // Read all events
    const eventsText = fs.readFileSync(eventsPath, 'utf8');
    const events = eventsText.trim().split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    
    // Get available frames
    let frames = [];
    if (fs.existsSync(framesDir)) {
        frames = fs.readdirSync(framesDir)
            .filter(f => f.endsWith('.jpg'))
            .map(f => parseInt(f.replace('.jpg', '')))
            .sort((a, b) => a - b);
    }
    
    // Correlate speech events with nearby frames
    const correlatedEvents = events.map(event => {
        if (event.etype === 'speech.final') {
            // Find frames within 2 seconds before/after speech
            const speechTime = event.t;
            const nearbyFrames = frames.filter(frameTime => 
                Math.abs(frameTime - speechTime) <= 2000
            ).slice(0, 3); // Max 3 frames per speech event
            
            return {
                ...event,
                related_frames: nearbyFrames.map(t => `${t}.jpg`),
                frame_count: nearbyFrames.length
            };
        }
        return event;
    });
    
    // Group events and add session insights
    const speechEvents = correlatedEvents.filter(e => e.etype === 'speech.final');
    const frameEvents = correlatedEvents.filter(e => e.etype === 'ui.frame');
    
    const result = {
        session_dir: path.basename(sessionDir),
        generated_at: new Date().toISOString(),
        summary: {
            total_events: correlatedEvents.length,
            speech_events: speechEvents.length,
            frame_events: frameEvents.length,
            duration_estimate_mins: Math.round((
                Math.max(...events.map(e => e.t)) - 
                Math.min(...events.map(e => e.t))
            ) / 60000),
            key_phrases: extractKeyPhrases(speechEvents)
        },
        events: correlatedEvents
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`✅ Correlated timeline saved: ${outputPath}`);
    return result;
}

function extractKeyPhrases(speechEvents) {
    // Simple keyword extraction from speech
    const allText = speechEvents.map(e => e.text).join(' ').toLowerCase();
    const keywords = ['terminal', 'fullscreen', 'bottom', 'layout', 'ui', 'screen', 'program', 'application'];
    
    return keywords.filter(keyword => allText.includes(keyword));
}

// Process session if called directly
if (require.main === module) {
    const sessionPath = process.argv[2];
    
    if (sessionPath) {
        // Process specific session
        console.log(`Correlating timeline for: ${path.basename(sessionPath)}`);
        correlateTimeline(sessionPath);
    } else {
        // Process most recent session
        const sessionsRoot = path.join(__dirname, '..', 'sessions');
        const sessions = fs.readdirSync(sessionsRoot)
            .filter(d => d.match(/^\d{4}-\d{2}-\d{2}T/) || d.match(/^session-/))
            .map(d => path.join(sessionsRoot, d))
            .filter(d => fs.statSync(d).isDirectory())
            .sort((a, b) => b.localeCompare(a)); // Most recent first
        
        if (sessions.length > 0) {
            console.log(`Correlating timeline for: ${path.basename(sessions[0])}`);
            correlateTimeline(sessions[0]);
        } else {
            console.log('No sessions found');
        }
    }
}

module.exports = { correlateTimeline };