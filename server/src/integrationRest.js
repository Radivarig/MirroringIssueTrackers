import config from '../config/integration.config'
import request from 'superagent'
import path from 'path'
import {throwIfValueNotAllowed} from './helpers'

export default async (opts) => {
  // options types
  const service: string = opts.service
  const method: string = opts.method && opts.method.toLowerCase()
  const url: string = opts.url
  const query: Object = opts.query || {}
  const data: Object = opts.data || {}

  throwIfValueNotAllowed (method, ["get", "put", "post", "patch", "delete"])
  throwIfValueNotAllowed (service, ["youtrack", "github"])

  let baseUrl
  switch (service) {
    case "github":
      baseUrl = config.github.url; break
    case "youtrack":
      baseUrl = config.youtrack.url; break
  }
  const requestUrl = `https://${path.join (baseUrl, url)}`

  const toSet = {
    "Accept": "application/json",
    "Authorization": service === "youtrack" ?
        `Bearer ${config.youtrack.token}`
      : `token ${config.github.token}`,
  }

  console.log (method, service, requestUrl)
  return await request[method] (requestUrl)
    .set (toSet)
    .query (query)
    .send (data)
}
