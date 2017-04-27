const express = require('express')
const app = express()

const bodyParser = require('body-parser')
const compression = require('compression')

const server_api = require('./server_api')
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

app.post('/ajax_post', server_api.ajax_post)
app.get('/ajax_get', (req, res) => res.send("GET working"))

module.exports = app
