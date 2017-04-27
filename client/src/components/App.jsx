import React from 'react'

export default ({
  request, response, isFetching, isError,
  changeRequest, submitRequest,
}) => {
  const buttonText = isFetching ? 'Please wait..' : 'Send'

  const responseOrError = isError ?
    'Error happened. Please try again.' : response

  const onChangeRequest = (e) => changeRequest(e.target.value)

  return (
    <div>

      <textarea
        cols={25} rows={5}
        value={request}
        onChange={onChangeRequest}
      />

      <button
        disabled={isFetching}
        onClick={submitRequest}
      >
        {buttonText}
      </button>

      <textarea
        cols={25} rows={5}
        value={responseOrError}
        disabled
      />

    </div>
  )
}
