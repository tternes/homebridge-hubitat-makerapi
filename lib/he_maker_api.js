var http = require('http')
const url = require('url');
var app_id, access_token, localHubIp, localHubPort;
var app_host, app_port, app_path, access_token, localHubIp;

const util = require('util')

function ignoreTheseAttributes() {
    return [
        'DeviceWatch-DeviceStatus', 'checkInterval', 'devTypeVer', 'dayPowerAvg', 'apiStatus', 'yearCost', 'yearUsage','monthUsage', 'monthEst', 'weekCost', 'todayUsage',
        'maxCodeLength', 'maxCodes', 'readingUpdated', 'maxEnergyReading', 'monthCost', 'maxPowerReading', 'minPowerReading', 'monthCost', 'weekUsage', 'minEnergyReading',
        'codeReport', 'scanCodes', 'verticalAccuracy', 'horizontalAccuracyMetric', 'altitudeMetric', 'latitude', 'distanceMetric', 'closestPlaceDistanceMetric',
        'closestPlaceDistance', 'leavingPlace', 'currentPlace', 'codeChanged', 'codeLength', 'lockCodes', 'healthStatus', 'horizontalAccuracy', 'bearing', 'speedMetric',
        'verticalAccuracyMetric', 'altitude', 'indicatorStatus', 'todayCost', 'longitude', 'distance', 'previousPlace','closestPlace', 'places', 'minCodeLength',
        'arrivingAtPlace', 'lastUpdatedDt', 'scheduleType', 'zoneStartDate', 'zoneElapsed', 'zoneDuration', 'watering', 'dataType', 'values'
    ];
}

function transformAllDeviceData(inData, detailQuery = false, debug=false)
{
    var returnData = [];
    inData.forEach(function(device) {
        if (debug) console.log('device:', device);
        var newDevice = [];
        newDevice.name = device.label;
        newDevice.basename = device.name;
        newDevice.deviceid = device.id;
        newDevice.manufacturerName = device.manufacturer ? device.manufacturer : '';
        newDevice.modelName = device.model ? device.model : '';
        newDevice.type = device.type;
        newDevice.capabilities = {};
        device.capabilities.forEach(function(capability) {
            newDevice.capabilities[capability.toString().toLowerCase()] = 1;
        });
        if (detailQuery === false)
        {
            newDevice.commands = {};
            device.commands.forEach(function(command) {
                newDevice.commands[command.command] = null;
            });

            newDevice.attributes = {};
            Object.keys(device.attributes).forEach(function(key) {
                if (!(ignoreTheseAttributes().indexOf(key) > -1)) {
                    newDevice.attributes[key] = device.attributes[key];
                };
            });
        }
        else
        {
            newDevice.commands = {};
            device.commands.forEach(function(command) {
                newDevice.commands[command] = null;
            });

            newDevice.attributes = {};
            for (var i = 0; i < device.attributes.length; i++)
            {
                newDevice.attributes[device.attributes[i].name] = device.attributes[i].currentValue;
            }
        }
        returnData.push(newDevice);
    });
    if (detailQuery && returnData.length === 1)
        return returnData[0];
    return returnData;
}


function _http(data) {
    //console.log("Calling " + platformName);
    return new Promise(function(resolve, reject) {

        var options = {
            hostname: app_host,
            port: app_port,
            path: app_path + data.path + "?access_token=" + access_token,
            method: data.method,
            headers: {}
        };
        if (data.port)
            options.port = data.port;
        if (data.hubAction)
        {
            options.path = data.path;
        }
        if (data.data) {
            data.data = JSON.stringify(data.data);
            options.headers['Content-Length'] = Buffer.byteLength(data.data);
            options.headers['Content-Type'] = "application/json";
        }
        if (data.debug) {
            console.log('_http options: ', JSON.stringify(options));
        }
        var str = '';
        var req = http.request(options, function(response) {
            response.on('data', function(chunk) {
                str += chunk;
            });

            response.on('end', function() {
                if (data.debug) {
                    console.log("response in http:", str, response.statusCode);
                }
                if (response.statusCode !== 200)
                {
                    reject(response);
                    return;
                }
                try {
                    str = JSON.parse(str);
                } catch (e) {
                    //if (data.debug) {
                    //    console.log(e.stack);
                    //    console.log("raw message", str);
                    //}
                    reject(str);
                    str = undefined;
                    //reject(e);
                }
                resolve(str);
                //if (callback) {
                //    callback(str);
                //    callback = undefined;
                //};
            });
        });

        if (data.data) {
            req.write(data.data);
        }

        req.end();

        req.on('error', function(e) {
            console.log("error at req: ", e.message);
            reject(e);
            //if (callback) {
            //    callback();
            //    callback = undefined;
            //};
        });
    });
}

function GET(data) {
    return new Promise(function(resolve, reject) {
        data.method = "GET";
        _http(data).then(function(resp){resolve(resp);}).catch(function(error){reject(error);});
    });
}

function POST(data) {
    return new Promise(function(resolve, reject) {
        data.method = "POST";
        _http(data).then(function(resp){resolve(resp);}).catch(function(error){reject(error);});
    });
}

var he_maker_api = {
    init: function(inURL, inAppID, inAccess_Token, hubIp) {
        var appURL = url.parse(inURL);
        app_host = appURL.hostname;
        app_port = appURL.port || 80;
        app_path = appURL.path;
        access_token = inAccess_Token;
    },
    rebootHub: function() {
        return new Promise(function(resolve, reject) {
            POST({
                debug: true,
                path: '/hub/reboot',
                port: 8080,
                hubAction: true
                }).then(function(resp){
                    resolve(resp);
                }).catch(function(error){reject(error);});
        });
    },
    getDevices: function() {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/devices/all'
                }).then(function(resp){
                    var newData = [];
                    newData.deviceList = transformAllDeviceData(resp);
                    resolve(newData);
                }).catch(function(error){reject(error);});
        }); 
    },
    runCommand: function(deviceid, command, secondaryValue = null) {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/devices/' + deviceid + '/' + command + (secondaryValue ? '/' + secondaryValue.value1 : '')
            }).then(function(resp) {
                resolve(resp);
            }).catch(function(err) {
                reject(err);
            });
        });
    },
    getDevicesSummary: function () {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/devices'
                }).then(function(resp){
                    resolve(resp);
                }).catch(function(error){reject(error);});
        });
    },
    getDeviceInfo: function(deviceid) {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/devices/' + deviceid
                }).then(function(body) {
                    resolve(transformAllDeviceData([body], true));
                })
                .catch(function(error) {
                    reject(error);
                });
        });
    },
    getModes: function () {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/modes'
            }).then(function(resp) {
                resolve(resp);
            }).catch(function(err) {
                reject(err);
            });
        });
    },
    getAlarmState: function() {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/hsm'
            }).then(function(resp) {
                resolve(resp);
            }).catch(function(err) {
                reject(err);
            });
        });
    },
    setAlarmState: function(newState) {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/hsm/' + newState
            }).then(function(resp) {
                resolve(resp);
            }).catch(function(err) {
                reject(err);
            });
        });
    },
    setMode: function (newMode) {
        return new Promise(function(resolve, reject) {
            GET({
                debug: false,
                path: '/modes/' + newMode
            }).then(function(resp) {
                resolve(resp);
            }).catch(function(err) {
                reject(err);
            });
        });
    },
    getAppHost: function() {
        return app_host;
    }

}
module.exports = {
        api: he_maker_api,
        ignoreTheseAttributes: ignoreTheseAttributes
    }



