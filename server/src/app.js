const express = require('express')
const app = express()

const bodyParser = require('body-parser')
const compression = require('compression')

const { handleWebhook } = require('./serverAPI')
const whitelist = require('./whitelist')

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

app.post('/github_webhook', handleWebhook.handleGithubRequest)
app.post('/youtrack_webhook', handleWebhook.handleYoutrackRequest)

module.exports = app
