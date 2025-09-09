// Import dependencies based on environment
let playwright, chromium;

if (process.env.IS_LOCAL === 'true') {
    // Local environment - use regular playwright
    try {
        const { chromium: playwrightChromium } = require('playwright');
        playwright = playwrightChromium;
        chromium = null;
    } catch (error) {
        console.log('⚠️ Playwright not found locally, falling back to layer dependencies');
        const { chromium: playwrightChromium } = require('playwright-core');
        playwright = playwrightChromium;
        chromium = require('@sparticuz/chromium');
    }
} else {
    // Lambda environment - use playwright-core with chromium layer
    const { chromium: playwrightChromium } = require('playwright-core');
    playwright = playwrightChromium;
    chromium = require('@sparticuz/chromium');
}

const crypto = require('crypto');

// Custom JWT implementation for Google Service Account
function createJWT(clientEmail, privateKey, scopes) {
    const now = Math.floor(Date.now() / 1000);
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };
    
    const payload = {
        iss: clientEmail,
        scope: scopes.join(' '),
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signatureInput), privateKey);
    const encodedSignature = signature.toString('base64url');
    
    return `${signatureInput}.${encodedSignature}`;
}

// Get Google OAuth2 access token
async function getAccessToken(clientEmail, privateKey, scopes) {
    const jwt = createJWT(clientEmail, privateKey, scopes);
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.access_token;
}

// Date helper functions to replace moment.js
function parseCollectionDate(dateStr) {
    // Parse "Thursday 11th September 2025" format
    const months = {
        'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
        'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
    };
    
    const match = dateStr.match(/\w+\s+(\d+)\w+\s+(\w+)\s+(\d+)/);
    if (!match) return null;
    
    const day = parseInt(match[1]);
    const month = months[match[2]];
    const year = parseInt(match[3]);
    
    if (month === undefined) return null;
    
    return new Date(year, month, day);
}

function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}

function subtractDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
}

function setTime(date, hours, minutes) {
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

async function scrapeBinCollection(address) {
    console.log(`🔍 Scraping bin collection times for: ${address}`);

    let browser = null;
    let page = null;

    try {
        // Launch browser (environment-specific)
        console.log('🚀 Launching browser...');
        
        if (process.env.IS_LOCAL === 'true') {
            // Local environment - use regular playwright
            browser = await playwright.launch({
                headless: true
            });
        } else {
            // Lambda environment - use Lambda layer approach
            browser = await playwright.launch({
                args: chromium.args, // Provided by the @sparticuz/chromium library
                headless: true,
                executablePath: await chromium.executablePath() // Provided by the library (Chromium location)
            });
        }

        page = await browser.newPage();

        // Navigate to the page
        console.log('📄 Navigating to the bin collection page...');
        await page.goto('https://waste.nc.north-herts.gov.uk/w/webpage/find-bin-collection-day-input-address', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Wait for the page to fully load
        console.log('⏳ Waiting for page to load...');
        await page.waitForTimeout(3000);

        // Wait for the form to be present
        console.log('🔍 Looking for the form...');
        await page.waitForSelector('form.system_form', { timeout: 10000 });

        // Find the address input field
        console.log('📝 Finding address input field...');
        const addressInput = await page.waitForSelector('form.system_form input.relation_path_type_ahead_search', {
            timeout: 10000
        });

        // Type the address into the input field to trigger AJAX search
        console.log(`⌨️  Typing address: ${address}`);
        await addressInput.click();
        await addressInput.fill(''); // Clear first
        await addressInput.fill(address); // Fill the address

        // Wait for AJAX request to complete
        console.log('⏳ Waiting for AJAX request...');
        await page.waitForTimeout(2000);

        // Find the type ahead results
        const selector = 'div.relation_path_type_ahead_results_holder li'
        try {
            console.log(`🔍 Trying selector: ${selector}`);
            await page.waitForSelector(selector, { timeout: 3000 });
            firstResult = page.locator(selector).first();
            console.log(`✅ Found results with selector: ${selector}`);
        } catch (error) {
            console.log(`❌ Selector ${selector} not found`);
            throw new Error('No search results found with any selector');
        }

        // Click on the first result
        console.log('🖱️  Clicking on first search result...');
        await firstResult.click();

        // Wait briefly for the selection to register
        await page.waitForTimeout(1000);

        // Find and click the submit button
        console.log('📤 Submitting form...');
        const submitButton = await page.waitForSelector('input[type="submit"]', { timeout: 5000 });
        await submitButton.click();

        // Wait for the results page to load
        console.log('⏳ Waiting for results...');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Extract bin collection information from listing template rows
        console.log('📋 Extracting bin collection information...');
        const collectionData = await page.evaluate(() => {
            const results = {};

            // Look for listing template rows which contain the bin collection data
            const listingRows = document.querySelectorAll('.listing_template_row');

            if (listingRows.length > 0) {
                listingRows.forEach((row) => {
                    const text = row.textContent.trim();
                    if (text) {
                        // Parse the text to extract waste type and collection date
                        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
                        
                        if (lines.length > 0) {
                            // First line is the waste type (key)
                            const wasteType = lines[0];
                            
                            // Look for the line that contains "Next collection" followed by the date
                            const collectionLine = lines.find(line => line.startsWith('Next collection'));
                            
                            if (collectionLine && wasteType) {
                                // Extract the date part after "Next collection"
                                const date = collectionLine.replace('Next collection', '').trim();
                                
                                // Only add if we haven't seen this waste type before (avoid duplicates)
                                if (!results[wasteType]) {
                                    results[wasteType] = date;
                                }
                            }
                        }
                    }
                });
            }

            return results;
        });

        console.log('✅ Extracted collection data:', JSON.stringify(collectionData, null, 2));

        // Get the current URL
        const currentUrl = page.url();
        console.log('📍 Current URL:', currentUrl);

        console.log('✅ Scraping completed successfully!');

        return {
            success: true,
            address: address,
            url: currentUrl,
            timestamp: new Date().toISOString(),
            collectionData: collectionData
        };

    } catch (error) {
        console.error('❌ Error during scraping:', error.message);

        // Take a screenshot for debugging if possible
        if (page) {
            try {
                await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
                console.log('📸 Screenshot saved as error-screenshot.png');
            } catch (screenshotError) {
                console.log('Could not take screenshot:', screenshotError.message);
            }
        }

        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };

    } finally {
        // Clean up resources
        if (page) {
            await page.close();
        }
        if (browser) {
            await browser.close();
        }
    }
}

async function createCalendarEvents(collectionData, address) {
    console.log('🔑 Setting up Google Calendar authentication...');
    
    // Get access token using custom JWT implementation
    const token = await getAccessToken(
        process.env.CLIENT_EMAIL,
        process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/calendar']
    );

    // First, remove existing bin collection events for this address
    console.log('🧹 Removing existing bin collection events...');
    const now = new Date();
    const futureDate = addMonths(now, 2);

    // List existing events
    const listResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.CALENDAR_ID)}/events?timeMin=${now.toISOString()}&timeMax=${futureDate.toISOString()}&q=${encodeURIComponent(`bin collection ${address}`)}&singleEvents=true&orderBy=startTime`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (listResponse.ok) {
        const existingEvents = await listResponse.json();
        
        // Delete existing bin events for this address
        for (const event of existingEvents.items || []) {
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.CALENDAR_ID)}/events/${event.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        }
    }

    let eventsCreated = 0;

    // Create new events based on collection data
    for (const [wasteType, collectionDateStr] of Object.entries(collectionData)) {
        try {
            // Parse the collection date (e.g., "Thursday 11th September 2025")
            const collectionDate = parseCollectionDate(collectionDateStr);
            
            if (collectionDate) {
                // Create reminder event for the night before (8:30 PM)
                const reminderStart = setTime(subtractDays(collectionDate, 1), 20, 30);
                const reminderEnd = new Date(reminderStart.getTime() + 60 * 60 * 1000); // Add 1 hour

                const event = {
                    summary: `🗑️ Bin Collection Reminder - ${wasteType}`,
                    description: `Reminder to put out ${wasteType} bin for collection tomorrow.\n\nAddress: ${address}\nCollection Date: ${collectionDateStr}`,
                    start: {
                        dateTime: reminderStart.toISOString(),
                        timeZone: 'Europe/London'
                    },
                    end: {
                        dateTime: reminderEnd.toISOString(),
                        timeZone: 'Europe/London'
                    },
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: 'popup', minutes: 5 },
                            { method: 'email', minutes: 60 }
                        ]
                    },
                    colorId: '2' // Green color for bin collection events
                };

                // Create the event
                const createResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.CALENDAR_ID)}/events`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event)
                });
                // const createResponse = {ok:true}

                if (createResponse.ok) {
                    console.log(`✅ Created reminder for ${wasteType} on ${reminderStart.toLocaleString('en-GB', { 
                        weekday: 'long', 
                        day: 'numeric', 
                        month: 'long', 
                        year: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    })}`);
                    eventsCreated++;
                } else {
                    console.error(`❌ Failed to create event for ${wasteType}: ${createResponse.status}`);
                }
            } else {
                console.log(`⚠️ Could not parse date for ${wasteType}: ${collectionDateStr}`);
            }
        } catch (error) {
            console.error(`❌ Failed to create event for ${wasteType}:`, error.message);
        }
    }

    return eventsCreated;
}

// Lambda handler function
exports.handler = async (event) => {
    try {
        console.log('Starting bin collection scraper...');

        const address = process.env.ADDRESS || '123 Some Road Hitchin AB1 2CD';
        console.log(`Checking bin times for: ${address}`);

        const result = await scrapeBinCollection(address);

        if (result.success && result.collectionData) {
            // Try to create Google Calendar events if credentials are provided
            let calendarEvents = 0;
            if (process.env.CLIENT_EMAIL && process.env.PRIVATE_KEY && process.env.CALENDAR_ID) {
                try {
                    console.log('Creating Google Calendar events...');
                    calendarEvents = await createCalendarEvents(result.collectionData, address);
                    console.log(`Created ${calendarEvents} calendar events`);
                } catch (calendarError) {
                    console.error('Calendar integration failed:', calendarError.message);
                }
            } else {
                console.log('Google Calendar credentials not provided, skipping calendar integration');
            }

            const response = {
                statusCode: 200,
                body: {
                    address,
                    collectionTimes: result.collectionData,
                    timestamp: new Date().toISOString(),
                    calendarEvents
                }
            };

            console.log('Scraping completed successfully');
            return response;
        } else {
            return {
                statusCode: 500,
                body: {
                    error: result.error || 'Scraping failed',
                    timestamp: new Date().toISOString()
                }
            };
        }

    } catch (error) {
        console.error('Error in Lambda handler:', error.message);
        return {
            statusCode: 500,
            body: {
                error: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};

module.exports = { handler: exports.handler, scrapeBinCollection, createCalendarEvents };