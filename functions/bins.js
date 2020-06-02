const {google} = require('googleapis')
const {JWT} = require('google-auth-library')
const p = require('phin')
const moment = require('moment')
require('dotenv').config()

const getDates = async () => {
  const res = await p(process.env.BINS_URL)
  const lines = res.body.toString('utf8').split(/\r?\n/)
  let currentType = 'unknown'
  let dates = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('Food Waste')) {
      currentType = 'food'
    } else if (line.includes('Refuse Collection')) {
      currentType = 'refuse'
    } else if (line.includes('Recycling Collection')) {
      currentType = 'recycling'
    } else if (line.includes('arry.push')) {
      if (currentType === 'refuse' || currentType === 'recycling') {
        dates.push({type: currentType, dateString: line.split('"')[1]})
      }
    }
  }
  return dates
}
const getAlertDates = async () => {
  let dates = await getDates()
  console.log('dates', dates)
  let alertDates = dates.map((d) => {
    let date = moment(d.dateString).subtract(1, 'days')
    d.week = date.isoWeek()
    d.alarmDateTimeStringStart = `${date.format('YYYY-MM-DD')}T20:00:00.000`
    d.alarmDateTimeStringEnd = `${date.format('YYYY-MM-DD')}T21:00:00.000`
    d.alarmTitle = `Bins - ${d.type.charAt(0).toUpperCase() + d.type.slice(1)} - For tomorrow`
    return d
  })
  console.log('alertDates', alertDates)
  return alertDates
}
const addBinEvents = async (auth, alertDates) => {
  const calendar = google.calendar({version: 'v3', auth})
  for (let i = 0; i < alertDates.length; i++) {
    const alertDate = alertDates[i]
    const insertReq = {
      calendarId: 'dangarfielduk@gmail.com',
      resource: {
        summary: alertDate.alarmTitle,
        start: {
          dateTime: alertDate.alarmDateTimeStringStart,
          timeZone: 'Europe/London'
        },
        end: {
          dateTime: alertDate.alarmDateTimeStringEnd,
          timeZone: 'Europe/London'
        },
        reminders: {
          useDefault: false,
          overrides: [
            {method: 'popup', 'minutes': 5}
          ]
        }
      }
    }
    console.log('insertReq', alertDate, insertReq)
    const insertRes = await calendar.events.insert(insertReq)
    console.log('insertRes', JSON.stringify(insertRes.data))
  }
}

const removeExistingBinEvents = async (auth) => {
  try {
    const calendar = google.calendar({version: 'v3', auth})
    let res = await calendar.events.list({
      calendarId: 'dangarfielduk@gmail.com',
      timeMin: (new Date()).toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime'
    })
    let binEvents = []
    for (let i = 0; i < res.data.items.length; i++) {
      const event = res.data.items[i]
      if (event.summary.includes('Bin')) {
        // Remove
        await calendar.events.delete({
          calendarId: 'dangarfielduk@gmail.com',
          eventId: event.id
        })
      }
    }
    return binEvents
  } catch (error) {
    console.log('error', error)
  }
}
const getAuth = async () => {
  const client = new JWT(
    process.env.CLIENT_EMAIL,
    null,
    process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  )

  return client
}
const updateBins = async () => {
  const auth = await getAuth()
  const alertDates = await getAlertDates()
  await removeExistingBinEvents(auth)
  await addBinEvents(auth, alertDates)
}

exports.handler = async (event, context) => {
  let code = ''
  if (event.queryStringParameters && event.queryStringParameters.code) {
    code = event.queryStringParameters.code
  }
  console.log('code', code)
  if (code === 'thing') {
    await updateBins()
    return {
      statusCode: 200,
      body: JSON.stringify({ msg: `Bins updated` })
    }
  } else {
    return {
      statusCode: 500,
      body: JSON.stringify({ msg: `Not authorised` })
    }
  }
}
