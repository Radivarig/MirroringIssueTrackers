import chai, {expect} from 'chai'
import helpers from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
// import integrationRest from '../src/integrationRest'

import auth from '../config/auth.config'

describe('repositoryExist', () => {
  const randomName = "temp-" + Math.random().toString(36).replace(/[^a-z0-9]+/g, '')

  it ('returns false for a non existing repository', async () => {
    const repoExist: boolean = await webhookHandler.repositoryExist (randomName, "github")
    expect (repoExist).to.equal (false)
  })

  it ('returns true for a known test repository', async () => {
    const repoExist: boolean = await webhookHandler.repositoryExist (auth.github.project, "github")
    expect (repoExist).to.equal (true)
  })

})
