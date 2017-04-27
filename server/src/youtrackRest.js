import { protocol, restUrl, token } from '../config/youtrack.config'
import request from 'superagent'
import path from 'path'

export default async (method: string, url: string, data = {}) => {
  method = method.toLowerCase()
  if (method !== "post" && method !== "get")
    throw "Parameter `method` has to be: \"post\" | \"get\""

  const youtrackUrl = `${protocol}://${path.join (restUrl, url)}`
  const toSet = {
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  }
  return await request[method] (youtrackUrl).set (toSet).send (data)
}
