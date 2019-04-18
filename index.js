const pluginName = 'homebridge-hubitat-makerapi';
const platformName = 'Hubitat-MakerAPI';
var he_st_api = require('./lib/he_maker_api').api;
var ignoreTheseAttributes = require('./lib/he_maker_api.js').ignoreTheseAttributes;
var Service,
    Characteristic,
    Accessory,
    uuid,
    HE_ST_Accessory,
    PlatformAccessory;
const util = require('util');
const uuidGen = require('./accessories/he_st_accessories').uuidGen;

module.exports = function(homebridge) {
    console.log("Homebridge Version: " + homebridge.version);
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;
    PlatformAccessory = homebridge.platformAccessory;
    HE_ST_Accessory = require('./accessories/he_st_accessories')(Accessory, Service, Characteristic, PlatformAccessory, uuid, platformName);
    homebridge.registerPlatform(pluginName, platformName, HE_ST_Platform, true);
};

function HE_ST_Platform(log, config, api) {
    if (!config) {
        log.warn("Ignoring " + platformName + " Platform setup because it is not configured");
        this.disabled = true;
        return;
    }
    this.temperature_unit = 'F';
    if (config)
    {
        this.app_url = config['app_url'];
        this.app_id = config['app_id'];
        this.access_token = config['access_token'];
        this.excludedAttributes = config["excluded_attributes"] || [];
        this.excludedCapabilities = config["excluded_capabilities"] || [];

        // This is how often it does a full refresh
        this.polling_seconds = config['polling_seconds'];
        this.mode_switches =  config['mode_switches'] || false;
    }
    if ((this.polling_seconds === undefined) || (this.polling_seconds === ''))
        this.polling_seconds = 300;
    if ((this.mode_switches === undefined) || (this.mode_switches === ''))
        this.mode_switches = false;
    // This is how often it polls for subscription data.
    this.config = config;
    this.api = he_st_api;
    this.log = log;
    this.deviceLookup = {};
    this.firstpoll = true;
    this.attributeLookup = {};
    this.hb_api = api;
    this.hb_api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}

HE_ST_Platform.prototype = {
    didFinishLaunching: function() {
        var that = this;
        if ((that.config === null) || (that.config === undefined)) {
            this.log('Platform unconfigured in config.json. Do nothing');
            return;
        }
        this.log('Fetching ' + platformName + ' devices. This can take a while depending on the number of devices configured in MakerAPI!');
        var that = this;
        he_st_api.init(this.app_url, this.app_id, this.access_token, this.local_hub_ip, this.local_commands);
        var starttime = new Date();
        this.reloadData(function(foundAccessories) {
            var timeElapsedinSeconds = Math.round((new Date() - starttime)/1000);
            if (timeElapsedinSeconds >= that.polling_seconds) {
                that.log('It took ' + timeElapsedinSeconds + ' seconds to get all data and polling_seconds is set to ' + that.polling_seconds);
                that.log(' Changing polling_seconds to ' + (timeElapsedinSeconds * 2) + ' seconds');
                that.polling_seconds = timeElapsedinSeconds * 2;
            } else if (that.polling_seconds < 30)
            {
                that.log('polling_seconds really shouldn\'t be smaller than 30 seconds. Setting it to 30 seconds');
                that.polling_seconds = 30;
            }
            setInterval(that.reloadData.bind(that), that.polling_seconds * 1000);
            he_eventsocket_SetupWebSocket(that);
        });
    },
    reloadData: function(callback) {
        var that = this;
        // that.log('config: ', JSON.stringify(this.config));
        var foundAccessories = [];
        that.log('Refreshing All Device Data');
        he_st_api.getDevicesSummary(function(myList) {
            that.log('Received All Device Data ');//, myList);
            // success
            if (myList) {
                var removeOldDevices = function(devices) {
                    var accessories = [];
                    Object.keys(that.deviceLookup).forEach(function(key) {
                        var unregister = true;
                        for (var i = 0; i < devices.length; i++) {
                            var uuid;
                            if (that.deviceLookup[key].UUID === uuidGen(devices[i].id))
                                unregister = false;
                        }
                        if (unregister)
                        {
                            accessories.push(that.deviceLookup[key]);
                        }
                    });
                    if (accessories.length) {
                        that.hb_api.unregisterPlatformAccessories(pluginName, platformName, accessories);
                        for (var i = 0; i < accessories.length; i++) {
                            if (that.deviceLookup[accessories[i].UUID] instanceof HE_ST_Accessory) {
                                that.log("Device Removed - Name " + that.deviceLookup[accessories[i].UUID].name + ', ID ' + that.deviceLookup[accessories[i].UUID].deviceid);
                                that.removeDeviceAttributeUsage(that.deviceLookup[accessories[i].UUID].deviceid);
                            }
                            if (that.deviceLookup.hasOwnProperty(accessories[i].UUID))
                                delete that.deviceLookup[accessories[i].UUID];
                        }
                    }
                };
                var populateDevices = function(devices) {
                    for (var i = 0; i < devices.length; i++) {
                        var device = devices[i];
                        var accessory;
                        if (that.deviceLookup[uuidGen(device.id)]) {
                            accessory = that.deviceLookup[uuidGen(device.id)];
                            //accessory.loadData(devices[i]);
                        } else { 
                            he_st_api.getDeviceInfo(device.id, function(data) {
                                data.excludedAttributes = that.excludedAttributes[device.id] || ["None"];
                                accessory = new HE_ST_Accessory(that, "device", data);
                                // that.log(accessory);
                                if (accessory !== undefined) {
                                    if (accessory.services.length <= 1 || accessory.deviceGroup === 'unknown') {
                                        if (that.firstpoll) {
                                            that.log('Device Skipped - Name ' + accessory.name + ', ID ' + accessory.deviceid + ', JSON: ' + JSON.stringify(device));
                                        }
                                    } else {
                                        that.log("Device Added - Name " + accessory.name + ", ID " + accessory.deviceid); //+", JSON: "+ JSON.stringify(device));
                                        that.deviceLookup[uuidGen(accessory.deviceid)] = accessory;
                                        that.hb_api.registerPlatformAccessories(pluginName, platformName, [accessory]);
                                        foundAccessories.push(accessory);
                                    }
                                }
                            });
                        }
                    }   
                };
                var updateDevices = function() {
                    if (that.firstpoll)
                        return;
                    var updateAccessories = [];
                    Object.keys(that.deviceLookup).forEach(function(key) {
                        updateAccessories.push(that.deviceLookup[key]);
                    });
                    if (updateAccessories.length)
                        that.hb_api.updatePlatformAccessories(updateAccessories);
                };
                if (myList && myList.location) {
                    that.temperature_unit = myList.location.temperature_scale;
                    if (myList.location.hubIP) {
                        that.local_hub_ip = myList.location.hubIP;
                        he_st_api.updateGlobals(that.local_hub_ip, that.local_commands);
                    }
                }
                var removeCachedDevices = function() {
                    Object.keys(that.deviceLookup).forEach(function(key) {
                        if (that.deviceLookup[key] instanceof PlatformAccessory) {
                            that.hb_api.unregisterPlatformAccessories(pluginName, platformName, [that.deviceLookup[key]]);
                            delete that.deviceLookup[key];
                        }
                    });
                };
                if (that.firstpoll) {
                    that.log("Clearing cached devices");
                    removeCachedDevices();
                }
                removeOldDevices(myList);
                populateDevices(myList);
                updateDevices();
            } else if (!myList || !myList.error) {
                that.log('Invalid Response from API call');
            } else if (myList.error) {
                that.log('Error received type ' + myList.type + ' - ' + myList.message);
            } else {
                that.log('Invalid Response from API call');
            }
            if (callback) 
                callback(foundAccessories);
            that.firstpoll = false;
        });
    },
    configureAccessory: function (accessory) {
        this.deviceLookup[accessory.UUID] = accessory;
    },
    accessories: function(callback) {
        var that = this;
        callback([]);
    },
    isAttributeUsed: function(attribute, deviceid) {
        if (!this.attributeLookup[attribute])
            return false;
        if (!this.attributeLookup[attribute][deviceid])
            return false;
        return true;
    },
    addAttributeUsage: function(attribute, deviceid, mycharacteristic) {
        if (!this.attributeLookup[attribute]) {
            this.attributeLookup[attribute] = {};
        }
        if (!this.attributeLookup[attribute][deviceid]) {
            this.attributeLookup[attribute][deviceid] = [];
        }
        this.attributeLookup[attribute][deviceid].push(mycharacteristic);
    },
    removeDeviceAttributeUsage: function(deviceid) {
        var that = this;
        Object.entries(that.attributeLookup).forEach((entry) => {
            const [key, value] = entry;
            if (that.attributeLookup[key].hasOwnProperty(deviceid))
                delete that.attributeLookup[key][deviceid];
        });
    }, 
    doIncrementalUpdate: function() {
        var that = this;
        he_st_api.getUpdates(function(data) {
            that.processIncrementalUpdate(data, that);
        });
    },

    processIncrementalUpdate: function(data, that) {
        that.log('new data: ' + data);
        if (data && data.attributes && data.attributes instanceof Array) {
            for (var i = 0; i < data.attributes.length; i++) {
                that.processFieldUpdate(data.attributes[i], that);
            }
        }
    },

    processFieldUpdate: function(attributeSet, that) {
        // that.log("Processing Update");
        // that.log(attributeSet);
        if (!(that.attributeLookup[attributeSet.attribute] && that.attributeLookup[attributeSet.attribute][attributeSet.device])) {
            return;
        }
        var myUsage = that.attributeLookup[attributeSet.attribute][attributeSet.device];
        if (myUsage instanceof Array) {
            for (var j = 0; j < myUsage.length; j++) {
                var accessory = that.deviceLookup[uuidGen(attributeSet.device)];
                if (accessory) {
//                    console.log("setting " + accessory.device.attributes[attributeSet.attribute] + " to " + attributeSet.value + " for " + util.inspect(myUsage[j], false, 1, true));
                    accessory.device.attributes[attributeSet.attribute] = attributeSet.value;
                    myUsage[j].getValue();
                }
            }
        }
    }
};

function he_eventsocket_SetupWebSocket(myHe_st_api) {
    const WebSocket = require('ws');
    var that = this;
    function connect(myHe_st_api) {
        var r = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
        var url = 'ws://' + myHe_st_api.app_url.match(r) + '/eventsocket';
        var ws = new WebSocket(url);
        myHe_st_api.log('connect to ' + url);
        ws.onopen = function() {
        };
    
        ws.onmessage = function(e) {
            var jsonData = JSON.parse(e.data);
            var newChange = [];
            if (jsonData['source'] === 'DEVICE')
            {
                if (myHe_st_api.isAttributeUsed(jsonData['name'], jsonData['deviceId']))
                    newChange.push( { device: jsonData['deviceId'], attribute: jsonData['name'], value: jsonData['value'], date: new Date() , displayName: jsonData['displayName'] }  );
                //else myHe_st_api.log('Ignore Attribute ' + jsonData['name'] + ' for device ' + jsonData['deviceId']);
                
            } 
            else if (jsonData['source'] === 'LOCATION')
            {
                switch (jsonData['name'])
                {
                    case 'hsmStatus':
                        newChange.push( { device: 'alarmSystemStatus_' + jsonData['locationId'], attribute: 'alarmSystemStatus', value: jsonData['value'], date: new Date(), displayName: jsonData['displayName'] });
                        break;
                    case 'hsmAlert':
                        if (jsonData['value'] === 'intrusion')
                        {
                            newChange.push( { device: 'alarmSystemStatus_' + jsonData['locationId'], attribute: 'alarmSystemStatus', value: 'alarm_active', date: new Date(), displayName: jsonData['displayName'] });
                        }
                        break;
                    case 'alarmSystemStatus':
                        newChange.push( { device: 'alarmSystemStatus_' + jsonData['locationId'], attribute: 'alarmSystemStatus', value: jsonData['value'], date: new Date(), displayName: jsonData['displayName'] });
                        break;
                    case 'mode':
                        myHe_st_api.deviceLookup.forEach(function (accessory)
                        {
                            if (accessory.deviceGroup === "mode")
                            {
                                if (accessory.name === "Mode - " + jsonData['value'])
                                    newChange.push( { device: accessory.deviceid, attribute: 'switch', value: 'on', date: new Date(), displayName: accessory.name });
                                else
                                    newChange.push( { device: accessory.deviceid, attribute: 'switch', value: 'off', date: new Date(), displayName: accessory.name });
                            }
                        });
                        break;
                }
            }
            newChange.forEach(function(element)
            {
                myHe_st_api.log('Change Event (Socket):', '(' + element['displayName'] + ':' + element['device'] + ') [' + (element['attribute'] ? element['attribute'].toUpperCase() : 'unknown') + '] is ' + element['value']);
                myHe_st_api.processFieldUpdate(element, myHe_st_api);
            });
        };

        ws.onclose = function(e) {
          myHe_st_api.log('HE Eventsocket is closed. Reconnect will be attempted in 1 second. ', e.reason);
          setTimeout(function() {
            connect(myHe_st_api);
          }, 1000);
        };

        ws.onerror = function(err) {
          myHe_st_api.log('HE Eventsocket encountered error: ', err.message, 'Closing socket');
          ws.close();
        };

    }
    connect(myHe_st_api); 

}

