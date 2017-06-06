import chai, {expect} from 'chai'
import helpers from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
// import integrationRest from '../src/integrationRest'

import auth from '../config/auth.config'

describe('projectExist', () => {
  const randomName = "temp-" + Math.random().toString(36).replace(/[^a-z0-9]+/g, '')

  it ('returns false for a non existing project', async () => {
    const projExist: boolean = await webhookHandler.projectExist (randomName, "github")
    expect (projExist).to.equal (false)
  })

  it ('returns true for a known test project', async () => {
    const projExist: boolean = await webhookHandler.projectExist (auth.github.project, "github")
    expect (projExist).to.equal (true)
  })

  it ('throws if any of services test project does not exist', async () => {
    await webhookHandler.throwIfAnyProjectNotExist ()
  })
})
