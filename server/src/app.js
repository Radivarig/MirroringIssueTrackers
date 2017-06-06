const express = require('express')
const app = express()

const bodyParser = require('body-parser')
const compression = require('compression')

const whitelist = require('./whitelist')

import {webhookHandler} from './serverAPI'

// eslint-disable-next-line no-undef
if (process.env.ENV === "production")
  webhookHandler.initDoMirroring ()

const allowCrossDomain = function (req, res, next) {
  res.header('Access-Control-Allow-Origin', whitelist)
  res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
}

// eslint-disable-next-line no-undef
app.set('port', process.env.PORT || 7777)
app.use(compression())
app.use(allowCrossDomain)
app.use(bodyParser.json())
app.enable('trust proxy')

app.post('/github_webhook', webhookHandler.handleRequest.bind (null, "github"))
app.post('/youtrack_webhook', webhookHandler.handleRequest.bind (null, "youtrack"))
app.get('/do_stuff', webhookHandler.doStuff)

module.exports = app
