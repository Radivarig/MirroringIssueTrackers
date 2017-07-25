const express = require('express')
const app = express()

const bodyParser = require('body-parser')
const compression = require('compression')

const whitelist = require('./whitelist')

import MirroringEngine from './MirroringEngine.js'
const mirroringEngine = new MirroringEngine ()

// eslint-disable-next-line no-undef
if (process.env.NODE_ENV === "production")
  mirroringEngine.doMirroring ()

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
//app.use (bodyParser.urlencoded ({ "extended": true }))
app.enable('trust proxy')

app.post('/github_webhook', mirroringEngine.handleWebhook.bind (null, "github"))
app.post('/youtrack_webhook', mirroringEngine.handleWebhook.bind (null, "youtrack"))

module.exports = app
