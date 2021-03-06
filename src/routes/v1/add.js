const { promisify: pify } = require(`util`)
const { archive } = require(`../../drive`)
const moment = require(`moment-timezone`)
const debug = require(`debug`)(`qnzl:aw-sync:add`)
const auth = require(`@qnzl/auth`)

let SEEN_BUCKETS = []

;(async () => {
  const bucketData = await archive.preadFile(`/buckets`)

  SEEN_BUCKETS = JSON.parse(bucketData)

  debug(`loaded bucket list: ${SEEN_BUCKETS}`)
})()

const groupEventsByTime = (data) => {
  return data.reduce((groups, event) => {
    const adjTimestamp = moment(event.timestamp).format(`YYYY-MM-DD`)

    if (adjTimestamp in groups) {
      groups[adjTimestamp].push(event)
    } else {
      groups[adjTimestamp] = [ event ]
    }

    return groups
  }, {})
}

const getPreexistingContents = async (file) => {
  return await archive.preadFile(file)
}

const dedupe = (events) => {
  const seenEventIds = new Set()

  return events.filter((event) => {
    if (!seenEventIds.has(event.id)) {
      seenEventIds.add(event.id)

      return true
    }

    return false
  })
}

const addEvents = async (ctx, next) => {
  const { id } = ctx.params
  debug(`got request for adding activity for watcher ${id}`)

  const { authorization } = ctx.req.headers

  const isValidToken = auth.checkJWT(authorization, `aw:update`, `watchers`, `https://qnzl.co`)

  if (!isValidToken) {
    debug(`failed to authenticate`)

    ctx.response.statusCode = 401

    return next()
  }

  debug(`successfully authenticated`)

  const { data } = ctx.request.body

  const groupedEvents = groupEventsByTime(data)

  debug(`adding activity for watcher ${id}`)

  if (!SEEN_BUCKETS.includes(id)) {
    debug(`have never seen ${id} before, adding to bucket list`)

    SEEN_BUCKETS.push(id)

    await archive.pwriteFile(`/buckets`, Buffer.from(JSON.stringify(SEEN_BUCKETS)))
  }

  try {
    Object.keys(groupedEvents).forEach(async (timestamp) => {
      let events = groupedEvents[timestamp]
      const file = `${id}/${timestamp}`

      debug(`${events.length} events have been sent in`)

      try {
        const preexistingEvents = JSON.parse(await getPreexistingContents(file))

        debug(`found ${preexistingEvents.length} events that already existed in ${file}`)

        events = dedupe(preexistingEvents.concat(events))
      } catch (e) {
        console.error(e)
      }

      debug(`has ${events.length} after deduping`)

      const stringifiedData = JSON.stringify(events)
      const bufferedData = Buffer.from(stringifiedData)

      debug(`writing file ${id} for timestamp ${timestamp}`)

      await archive.pwriteFile(file, bufferedData)

      debug(`wrote file ${id} for timestamp ${timestamp}`)
    })

    ctx.response.status = 200

    return next()
  } catch (e) {
    ctx.response.status = 500

    debug(`failed to write file`, e)
    return next(e)
  }
}

module.exports = addEvents

