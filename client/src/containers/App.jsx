import React from 'react'
import { connect } from 'react-redux'
import { mapDispatchToProps } from 'reducers/requestResponse'
import App from 'components/App'

const mapStateToProps = (state) => {
  const s = state.requestResponse
  return {
    request: s.request,
    response: s.response,
    isFetching: s.isFetching,
    isError: s.isError,
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
) (App)
