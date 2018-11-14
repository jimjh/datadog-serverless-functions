// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2018 Datadog, Inc.

var tls = require('tls');
var DD_API_KEY = process.env.DD_API_KEY || '<DATADOG_API_KEY>';
var DD_URL = process.env.DD_URL || 'lambda-intake.logs.datadoghq.com';
var DD_TAGS = process.env.DD_TAGS || '<TAG_KEY>:<TAG_VALUE>';
var DD_PORT = process.env.DD_PORT || 10516;
var DD_SERVICE = process.env.DD_SERVICE || 'azure';
var DD_SOURCE = process.env.DD_SOURCE || 'azure';
var DD_SOURCE_CATEGORY = process.env.DD_SOURCE_CATEGORY || 'azure';

module.exports = function (context, eventHubMessages) {
    if (DD_API_KEY === '<DATADOG_API_KEY>' || DD_API_KEY === '' || DD_API_KEY === undefined) {
        context.log('You must configure your API key before starting this function (see ## Parameters section)');
        return;
    }

    if (DD_TAGS === '<TAG_KEY>:<TAG_VALUE>') {
        context.log.warn('You must configure your tags with a comma separated list of tags or an empty string');
    }

    if (eventHubMessages.length == 0) {
        return;
    }

    var socket = connectToDD(context);
    var handleLogs = tagger => record => {
        record = tagger(record, context);
        if (!send(socket, record)) {
            // Retry once
            socket = connectToDD(context);
            send(socket, record);
        }
    }

    // This shouldn't happen when eventHub cardinality is set to "many"
    if (typeof eventHubMessages === 'string') {
        handleLogs(addTagsStringLog)(eventHubMessages);
        socket.end();
        context.done();
        return;
    }

    // eventHubMessages default format is [{"records": [{}, {}, ...]}, {"records": [{}, {}, ...]}, ...]
    if (typeof eventHubMessages[0] === 'object' && eventHubMessages[0].records !== undefined) {
        eventHubMessages.forEach( message => {
            message.records.forEach( handleLogs(addTagsJsonLog) );
        })
    }

    // eventHubMessages can also be ["log1", "log2", ...]
    if (typeof eventHubMessages[0] === 'string') {
        eventHubMessages.forEach( handleLogs(addTagsStringLog) );
    }

    socket.end();
    context.done();
};

function addTagsJsonLog(record, context) {
    record['ddsource'] = DD_SOURCE;
    record['ddsourcecategory'] = DD_SOURCE_CATEGORY;
    record['service'] = DD_SERVICE;
    record['ddtags'] = [DD_TAGS, 'forwardername:' + context.executionContext.functionName].filter(Boolean).join(',');
    return record;
}

function addTagsStringLog(stringLog, context) {
    jsonLog = {'message': stringLog};
    jsonLog['ddsource'] = DD_SOURCE;
    jsonLog['ddsourcecategory'] = DD_SOURCE_CATEGORY;
    jsonLog['service'] = DD_SERVICE;
    jsonLog['ddtags'] = [DD_TAGS, 'forwardername:' + context.executionContext.functionName].filter(Boolean).join(',');
    return jsonLog;
}

function connectToDD(context) {
    var socket = tls.connect({port: DD_PORT, host: DD_URL});
    socket.on('error', err => {
        context.log.error(err.toString());
        socket.end();
    });

    return socket;
}

function send(socket, record) {
    return socket.write(DD_API_KEY + ' ' + JSON.stringify(record) + '\n');
}
