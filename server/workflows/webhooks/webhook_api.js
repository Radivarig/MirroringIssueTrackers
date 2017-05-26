var http = require("v1/http");
var config = require("./config");

exports.postSync = function(payload) {
    var connection = new http.Connection(config.url, config.sslKeyName);

    connection.addHeader({name: "Accept", value: "application/json"});
    connection.addHeader({name: "Content-Type", value: "application/json"});

    // when api updates, hopefully there will be a way to release connection immediately
    // connection.request(http.REQUEST_TYPES.POST, '', [], payload, null, null);

    return connection.doSync(http.REQUEST_TYPES.POST, '', [], payload);
};