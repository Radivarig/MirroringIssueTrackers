import { protocol, restUrl, token } from '../config/youtrack.config'
import request from 'superagent'
import path from 'path'

export default async (opts) => {
  // options types
  const method: string = opts.method && opts.method.toLowerCase()
  const url: string = opts.url
  const query: Object = opts.query || {}
  const data: Object =opts.data || {}

  const allowedMethods = ["get", "put", "post"]
  if (allowedMethods.indexOf (method) === -1)
    throw "Parameter `method` has to be: " + allowedMethods.join (" | ")

  const youtrackUrl = `${protocol}://${path.join (restUrl, url)}`
  const toSet = {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  }
  return await request[method] (youtrackUrl)
    .set (toSet)
    .query (query)
    .send (data)
}
