const { createHash } = require('crypto')
const payload = require('@bugsnag/core/lib/json-payload')
const PayloadQueue = require('./queue')
const PayloadDeliveryLoop = require('./payload-loop')

const delivery = (client, filestore, net) => {
  const send = (opts, body, cb) => {
    const req = net.request(opts, response => {
      if (isOk(response)) {
        cb(null)
      } else {
        const err = new Error(`Bad status code from API: ${response.statusCode}`)
        err.isRetryable = isRetryable(response.statusCode)
        cb(err)
      }
    })
    req.on('error', cb)
    req.write(body)
    req.end()
  }

  const logError = e => client._logger.error('Error delivering payload', e)

  const enqueue = async (payloadKind, failedPayload) => {
    client._logger.info(`Writing ${payloadKind} payload to cache`)
    await queues[payloadKind].enqueue(failedPayload, logError)
    queueConsumers[payloadKind].start()
  }

  const onerror = async (err, failedPayload, payloadKind, cb) => {
    client._logger.error(`${payloadKind} failed to send…\n`, (err && err.stack) ? err.stack : err)
    if (failedPayload && err.isRetryable !== false) enqueue(payloadKind, failedPayload)
    cb(err)
  }

  const { queues, queueConsumers } = initRedelivery(filestore.getPaths(), client._logger, send)

  const hash = payload => {
    const h = createHash('sha1')
    h.update(payload)
    return h.digest('hex')
  }

  return {
    sendEvent: async (event, cb = () => {}) => {
      const url = client._config.endpoints.notify

      let body, opts
      try {
        body = payload.event(event, client._config.redactedKeys)
        opts = {
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Bugsnag-Api-Key': event.apiKey || client._config.apiKey,
            'Bugsnag-Integrity': `sha1 ${hash(body)}`,
            'Bugsnag-Payload-Version': '4',
            'Bugsnag-Sent-At': (new Date()).toISOString()
          }
        }
        if (event.attemptImmediateDelivery === false) {
          enqueue('event', { opts, body })
          return cb(null)
        }
        const { errorClass, errorMessage } = event.events[0].errors[0]
        client._logger.info(`Sending event ${errorClass}: ${errorMessage}`)
        send(opts, body, err => {
          if (err) return onerror(err, { opts, body }, 'event', cb)
          cb(null)
        })
      } catch (e) {
        onerror(e, { url, opts }, 'event', cb)
      }
    },

    sendSession: async (session, cb = () => {}) => {
      const url = client._config.endpoints.sessions

      let body, opts
      try {
        body = payload.session(session, client._config.redactedKeys)
        opts = {
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Bugsnag-Api-Key': client._config.apiKey,
            'Bugsnag-Integrity': `sha1 ${hash(body)}`,
            'Bugsnag-Payload-Version': '1',
            'Bugsnag-Sent-At': (new Date()).toISOString()
          }
        }
        client._logger.info('Sending session')
        send(opts, body, err => {
          if (err) return onerror(err, { opts, body }, 'session', cb)
          cb(null)
        })
      } catch (e) {
        onerror(e, { url, opts }, 'session', cb)
      }
    }
  }
}

const initRedelivery = (paths, logger, send) => {
  const onQueueError = e => logger.error('PayloadQueue error', e)
  const queues = {
    event: new PayloadQueue(paths.events, 'event', onQueueError),
    session: new PayloadQueue(paths.sessions, 'session', onQueueError)
  }

  const onLoopError = e => logger.error('PayloadDeliveryLoop error', e)
  const queueConsumers = {
    event: new PayloadDeliveryLoop(send, queues.event, onLoopError),
    session: new PayloadDeliveryLoop(send, queues.session, onLoopError)
  }

  for (const queue in queues) {
    queues[queue].init()
      .then(() => queueConsumers[queue].start())
      .catch(onQueueError)
  }

  return { queues, queueConsumers }
}

// basically, if it starts with a 4, don't retry (unless it's in the list of
// exceptions)
const isRetryable = status => {
  return (
    status < 400 ||
    status > 499 ||
    [
      408, // timeout
      429 // too many requests
    ].includes(status))
}

const isOk = response => [200, 202].includes(response.statusCode)

module.exports = (filestore, net) => client => delivery(client, filestore, net)
