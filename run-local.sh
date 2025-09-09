#!/bin/bash

echo "🗑️  North Hertfordshire Council Bin Collection Scraper (Local)"
echo "======================================================================"
echo "📍 Using address from .env file"
echo "📅 Using Google Calendar settings from .env file"
echo "======================================================================"

# Change to local directory
cd local

# Install local dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing local development dependencies..."
    npm install
    echo "🎭 Installing Playwright browsers..."
    npx playwright install chromium
fi

# Create a local version of the scraper with full Playwright
echo "📝 Creating local test file..."
cat > test-local.js << 'EOF'
require('dotenv').config({ path: '../.env' });

// Set environment variable to indicate local execution
process.env.IS_LOCAL = 'true';

// Import the Lambda scraper and modify it for local use
const fs = require('fs');
const path = require('path');

// Read the Lambda scraper file
const scraperPath = path.join(__dirname, '../lambda/scraper.js');
let scraperCode = fs.readFileSync(scraperPath, 'utf8');

// Replace playwright-core with playwright for local development
scraperCode = scraperCode.replace(/require\('playwright-core'\)/g, "require('playwright')");

// Write the modified code to a temporary file
const tempScraperPath = path.join(__dirname, 'scraper-local.js');
fs.writeFileSync(tempScraperPath, scraperCode);

// Import and run the handler
const { handler } = require('./scraper-local.js');

async function runLocal() {
    try {
        console.log('🚀 Starting local execution...\n');
        
        // Simulate Lambda event
        const event = {};
        
        const result = await handler(event);
        
        console.log('\n📊 Results:');
        console.log('='.repeat(70));
        console.log(`Status: ${result.statusCode}`);
        
        if (result.statusCode === 200) {
            console.log('\n🗑️  Bin Collection Schedule:');
            console.log('='.repeat(70));
            
            const collectionTimes = result.body.collectionTimes;
            Object.entries(collectionTimes).forEach(([wasteType, collectionDate]) => {
                console.log(`${wasteType}: ${collectionDate}`);
            });
            
            if (result.body.calendarEvents > 0) {
                console.log(`\n📅 Created ${result.body.calendarEvents} calendar events`);
            }
        } else {
            console.log('\n❌ Error:');
            console.log(result.body.error);
        }
        
    } catch (error) {
        console.error('\n❌ Local execution failed:', error.message);
        process.exit(1);
    } finally {
        // Clean up temporary file
        if (fs.existsSync(tempScraperPath)) {
            fs.unlinkSync(tempScraperPath);
        }
    }
}

runLocal();
EOF

# Run the test
echo "🚀 Executing Lambda function locally..."
node test-local.js

# Clean up
rm -f test-local.js

echo ""
echo "✅ Local execution completed!"