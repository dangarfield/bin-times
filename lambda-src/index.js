const playwright = require('playwright-aws-lambda');
const { google } = require('googleapis');
const moment = require('moment');

exports.handler = async (event) => {
  let browser = null;
  let page = null;
  
  try {
    console.log('Starting bin collection scraper...');
    
    const address = process.env.ADDRESS || '243 Cambridge Road Hitchin SG4 0JS';
    console.log(`Checking bin times for: ${address}`);
    
    // Launch browser
    browser = await playwright.launchChromium({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    
    page = await browser.newPage();
    
    // Navigate to the bin collection page
    console.log('Navigating to North Hertfordshire Council website...');
    await page.goto('https://www.north-herts.gov.uk/waste-and-recycling/bin-collection-days', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for and fill the address input
    console.log('Filling address form...');
    await page.waitForSelector('input[name="address"]', { timeout: 10000 });
    await page.fill('input[name="address"]', address);
    
    // Submit the form
    await page.click('button[type="submit"], input[type="submit"]');
    
    // Wait for results
    console.log('Waiting for results...');
    await page.waitForSelector('.bin-collection-info, .collection-info, .waste-collection', { timeout: 15000 });
    
    // Extract bin collection information
    const collectionData = await page.evaluate(() => {
      const results = {};
      
      // Look for various selectors that might contain the bin information
      const selectors = [
        '.bin-collection-info',
        '.collection-info', 
        '.waste-collection',
        '[data-testid*="collection"]',
        '.collection-day',
        '.bin-day'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((element, index) => {
            const text = element.textContent.trim();
            if (text) {
              results[`collection_${index}`] = text;
            }
          });
          break;
        }
      }
      
      // If no specific selectors found, get all text content
      if (Object.keys(results).length === 0) {
        const bodyText = document.body.textContent;
        const lines = bodyText.split('\n').filter(line => 
          line.trim() && 
          (line.includes('bin') || line.includes('collection') || line.includes('waste'))
        );
        
        lines.forEach((line, index) => {
          if (index < 10) { // Limit to first 10 relevant lines
            results[`info_${index}`] = line.trim();
          }
        });
      }
      
      return results;
    });
    
    console.log('Extracted collection data:', collectionData);
    
    // Process and structure the data
    const structuredData = {
      address: address,
      collectionTimes: collectionData,
      timestamp: new Date().toISOString()
    };
    
    // Try to create Google Calendar events if credentials are provided
    let calendarEvents = 0;
    if (process.env.CLIENT_EMAIL && process.env.PRIVATE_KEY && process.env.CALENDAR_ID) {
      try {
        console.log('Creating Google Calendar events...');
        calendarEvents = await createCalendarEvents(structuredData);
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
        ...structuredData,
        calendarEvents: calendarEvents
      }
    };
    
    console.log('Scraping completed successfully');
    return response;
    
  } catch (error) {
    console.error('Error during scraping:', error);
    
    return {
      statusCode: 500,
      body: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  } finally {
    // Clean up resources
    try {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
  }
};

async function createCalendarEvents(data) {
  const auth = new google.auth.JWT(
    process.env.CLIENT_EMAIL,
    null,
    process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  
  const calendar = google.calendar({ version: 'v3', auth });
  
  // First, remove existing bin collection events
  const now = moment();
  const futureDate = moment().add(2, 'months');
  
  const existingEvents = await calendar.events.list({
    calendarId: process.env.CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: futureDate.toISOString(),
    q: 'bin collection',
    singleEvents: true,
    orderBy: 'startTime'
  });
  
  // Delete existing bin events
  for (const event of existingEvents.data.items || []) {
    await calendar.events.delete({
      calendarId: process.env.CALENDAR_ID,
      eventId: event.id
    });
  }
  
  let eventsCreated = 0;
  
  // Create new events based on collection data
  for (const [key, value] of Object.entries(data.collectionTimes)) {
    if (typeof value === 'string' && value.includes('collection')) {
      // Try to extract date information and create calendar event
      const eventDate = extractDateFromText(value);
      if (eventDate) {
        const eventStart = moment(eventDate).subtract(1, 'day').hour(20).minute(30);
        const eventEnd = moment(eventDate).subtract(1, 'day').hour(21).minute(30);
        
        const event = {
          summary: `Bin Collection Reminder - ${key}`,
          description: value,
          start: {
            dateTime: eventStart.toISOString(),
            timeZone: 'Europe/London'
          },
          end: {
            dateTime: eventEnd.toISOString(),
            timeZone: 'Europe/London'
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 5 }
            ]
          }
        };
        
        await calendar.events.insert({
          calendarId: process.env.CALENDAR_ID,
          resource: event
        });
        
        eventsCreated++;
      }
    }
  }
  
  return eventsCreated;
}

function extractDateFromText(text) {
  // Try to extract date from text like "Tuesday 12th August 2025"
  const dateRegex = /(\w+day)\s+(\d{1,2})\w{0,2}\s+(\w+)\s+(\d{4})/i;
  const match = text.match(dateRegex);
  
  if (match) {
    const [, dayName, day, month, year] = match;
    const dateStr = `${day} ${month} ${year}`;
    const parsedDate = moment(dateStr, 'DD MMMM YYYY');
    
    if (parsedDate.isValid()) {
      return parsedDate.toDate();
    }
  }
  
  return null;
}
