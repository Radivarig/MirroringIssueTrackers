import auth from '../config/auth.config'
import request from 'superagent'
import path from 'path'

import {
  Service,
} from "./types"

export default async (opts) => {
  // options types
  const service: Service = opts.service
  const method: string = opts.method && opts.method.toLowerCase()
  const url: string = opts.url
  const query: Object | void = opts.query
  const data: Object | void = opts.data

  let baseUrl
  let protocol
  switch (service) {
    case "github":
      protocol = "https"
      baseUrl = auth.github.url; break
    case "youtrack":
      protocol = "http"
      baseUrl = auth.youtrack.url; break
  }
  const requestUrl = `${protocol}://${path.join (baseUrl, url)}`

  const toSet = {
    "Accept": "application/json",
    "Authorization": service === "youtrack" ?
        `Bearer ${auth.youtrack.token}`
      : `token ${auth.github.token}`,
  }

  // console.log (method, service, requestUrl, query ? {query} : "", data ? {data} : "", "\n")
  return await request[method] (requestUrl)
    .set (toSet)
    .query (query)
    .send (data)
    // .on ("error", (err) => {console.log (method, service, requestUrl, query, data)})
}
