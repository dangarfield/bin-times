const {google} = require('googleapis')
const {JWT} = require('google-auth-library')
const moment = require('moment')
const axios = require('axios')
const cheerio = require('cheerio')
require('dotenv').config()

const getDates = async () => {

  axios.defaults.withCredentials = true

  const p1Html = (await axios.get('https://uhtn-wrp.whitespacews.com/')).data
  // console.log('p1Html',p1Html)
  let $ = cheerio.load(p1Html)
  const p1Link = $('a.govuk-link:contains("Find my bin")')[0]
  const p1Href = $(p1Link).attr('href')
  console.log('p1Href', p1Href)

  const p2Href = p1Href.replace('seq=1','seq=2')

  const form = new FormData()
  form.append('address_name_number', process.env.ADDRESS_NO)
  form.append('address_street', '')
  form.append('street_town', '')
  form.append('address_postcode', process.env.ADDRESS_POSTCODE)

  const p3Html = (await axios({
    method: "post",
    url: p2Href,
    data: form,
    headers: { "Content-Type": "multipart/form-data" },
  })).data
  // console.log('p3Html',p3Html)
  $ = cheerio.load(p3Html)
  const p3Link = $('a.govuk-link.clicker')[0]
  // console.log('p3Link', p3Link)
  const p3Href = 'https://uhtn-wrp.whitespacews.com/' + $(p3Link).attr('href')
  console.log('p3Href', p3Href)

  const p4Html = (await axios.get(p3Href)).data
  // console.log('p4Html',p4Html)
  $ = cheerio.load(p4Html)
  const lines = $('#scheduled-collections li p').map((i, el) => {
    return $(el).text()
  }).get()

  // console.log('list', list, list.length)

  let dates = []
  for (let i = 0; i < lines.length; i=i+2) {
    console.log('event', i,lines[i],lines[i+1])
    let currentType = 'unknown'
    if (lines[i+1].includes('Food Waste')) {
      currentType = 'food'
    } else if (lines[i+1].includes('Refuse Collection')) {
      currentType = 'refuse'
    } else if (lines[i+1].includes('Recycling Collection')) {
      currentType = 'recycling'
    }
    if (currentType === 'refuse' || currentType === 'recycling') {
      dates.push({type: currentType, dateString: lines[i]})
    }
  }
  return dates
}
const getAlertDates = async () => {
  let dates = await getDates()
  console.log('dates', dates)
  let alertDates = dates.map((d) => {
    let date = moment(d.dateString,'DD-MM-YYYY').subtract(1, 'days')
    d.week = date.isoWeek()
    d.alarmDateTimeStringStart = `${date.format('YYYY-MM-DD')}T20:30:00.000`
    d.alarmDateTimeStringEnd = `${date.format('YYYY-MM-DD')}T21:30:00.000`
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
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    let res = await calendar.events.list({
      calendarId: 'dangarfielduk@gmail.com',
      timeMin: new Date().toISOString(),
      timeMax: oneYearFromNow.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime'
    })
    console.log('binEvents', res.data.items.map(i => i.summary), res.data.items.length)
    let binEvents = []
    for (let i = 0; i < res.data.items.length; i++) {
      const event = res.data.items[i]
      if (event.summary.includes('Bin')) {
        // Remove
        console.log('binEvent', event)
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
  if (code === process.env.BINS_ACCESS_CODE) {
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
