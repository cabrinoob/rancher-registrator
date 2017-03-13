var async = require('async');
var request = require('request');
var DockerEvents = require('docker-events'),
    Dockerode = require('dockerode')
var emitter = new DockerEvents({
    docker: new Dockerode({socketPath: '/var/run/docker.sock'}),
});

var _prefix = process.env.SVC_PREFIX || "";
var _consulAgent = process.env.LOCAL_CONSUL_AGENT || "http://localhost:8500";

var _re = /^([a-zA-Z0-9][a-zA-Z0-9_.-]+):[0-9]+(?::udp)?$/;


Array.prototype.flatten = function() {
    var ret = [];
    for(var i = 0; i < this.length; i++) {
        if(Array.isArray(this[i])) {
            ret = ret.concat(this[i].flatten());
        } else {
            ret.push(this[i]);
        }
    }
    return ret;
};


emitter.start();

emitter.on("connect", function() {
    console.log("connected to docker api");

    console.log("register existing containers");

    getAllMetaData()
        .then(registerContainers)
        .then(function (value) {
            console.log(value);
        }).catch(function(err){
            console.log("startup ERROR : " + err);
        })
});

emitter.on('start', function(evt){

    var name = evt.Actor.Attributes['io.rancher.container.name'] || evt.Actor.Attributes.name;
    console.log(new Date() + ' - container start ' + name + ' (image : '+evt.Actor.Attributes.image+')');
    getMetaData(name)
        .then(tryRegisterContainer)
        .then(function (value) {
            console.log(value);
        }).catch(function(err){
            console.log("ERROR : " + err);
        })
});

emitter.on('stop', function(evt){

    var name = evt.Actor.Attributes['io.rancher.container.name'] || evt.Actor.Attributes.name;
    console.log(new Date() + ' - container stop ' + name + ' (image : '+evt.Actor.Attributes.image+')');

    getMetaData(name)
        .then(getAgentIP)
        .then(checkForPortMapping)
        .then(deregisterService)
        .then(function (value) {
            console.log(value);
        }).catch(function(err){
            console.log("Deregistering ERROR : " + err);
        })
});

function getAllMetaData(){
    return new Promise(
        function(resolve,reject){
            console.log("query for existing containers");

            var query = {
                "method":"GET",
                "url": "http://rancher-metadata/latest/containers",
                "headers":{
                    "accept" : "application/json"
                }
            }

            request(query,function (error, response, body) {
                if (error) {
                    reject("getAllMetaData error : " + error);
                }

                var output = {};
                output.containers = JSON.parse(body);
                resolve(output);
            })
        }
    )
}

function registerContainers(input) {
    var promises = [];

    for (let container of input.containers) {
        var temp = {};
        temp.metadata = container;
        temp.servicename = container.name;

        promises.push(tryRegisterContainer(temp));
    }
    
    return Promise.all(promises)
        .then(value => {
            return Promise.resolve(value.flatten().filter(Boolean));
        });
}

function tryRegisterContainer(input){
    return new Promise(
        function(resolve, reject) {
            //console.log("tryRegisterContainer: " + input.servicename);

            resolve(input);
        })
        .then(getAgentIP)
        .then(checkForPortMapping)
        .then(checkForServiceIgnoreLabel)
        .then(checkForServiceNameLabel)
        .then(checkForServiceTagsLabel)
        .then(checkForHealthCheckLabel)
        .then(registerService)
        .catch(function(err){
            console.log(err);
        })
}

function getServiceIDs(input) {
                            var uniqueIDs = [];

                            input.metadata.portMapping.forEach(function(pm){
                                var id = input.metadata.uuid + ":" + pm.publicPort;

                                if(pm.transport == "udp")
                                    id += ":udp";
                                uniqueIDs.push(id)
                            });

    return uniqueIDs;
}

function getMetaData(servicename){
    return new Promise(
        function(resolve,reject){
            var query = {
                "method":"GET",
                "url": "http://rancher-metadata/latest/containers/" + servicename,
                "headers":{
                    "accept" : "application/json"
                }
            }

            request(query,function (error, response, body) {
                if (error) {
                    reject("getMetaData error : " + error);
                }

                var output = {};
                output.metadata = JSON.parse(body);
                output.servicename = servicename;
                resolve(output);
            })
        }
    )
}

function getAgentIP(input){
    return new Promise(
        function(resolve,reject){
            //console.log("getAgentIP: " + input.servicename);

            var query = {
                "method":"GET",
                "url": "http://rancher-metadata/latest/self/host",
                "headers":{
                    "accept" : "application/json"
                }
            }

            request(query,function (error, response, body) {
                if (error) {
                    reject("getAgentIP error : " + error);
                }

                input.metadata.hostIP = JSON.parse(body).agent_ip;
                resolve(input);
            })
        }
    )
}

function checkForPortMapping(input){
    return new Promise(
        function(resolve,reject){
            //console.log("checkForPortMapping: " + input.servicename);

            if(input.metadata.ports && input.metadata.ports.length > 0){
                input.metadata.portMapping = [];
                input.metadata.ports.forEach(function(pm){
                    var portMapping = pm.split(":");
                    var internal = portMapping[2].split("/");
                    var ip = input.metadata.hostIP;
                    input.metadata.portMapping.push({"address":ip,"publicPort":portMapping[1],"privatePort":internal[0],"transport":internal[1]});
                })
                resolve(input);
            }
            else
            {
                reject("No port mappings for " + input.servicename)
            }
        }
    )
}

function checkForServiceIgnoreLabel(input){
    return new Promise(
        function(resolve,reject){
            if(input.metadata.labels.SERVICE_IGNORE){
                console.log("Service_Ignore found");
                reject("Service ignored " + input.servicename);
            }
            else {
                resolve(input)
            }

        }
    )
}

function checkForServiceNameLabel(input){
    return new Promise(
        function(resolve,reject){
            if(input.metadata.labels.SERVICE_NAME){
                console.log("Service_Name found");
                input.metadata.service_name = input.metadata.labels.SERVICE_NAME;
            }
            resolve(input)
        }
    )
}

function checkForServiceTagsLabel(input){
    return new Promise(
        function(resolve,reject){
            if(input.metadata.labels.SERVICE_TAGS){
                console.log("Service_Tags found");
                input.metadata.service_tags = input.metadata.labels.SERVICE_TAGS.split(",");
            }
            port_names = {};
            for (var key in input.metadata.labels) {
                if (input.metadata.labels.hasOwnProperty(key)) {

                    //Check if SERVICE_XXX_NAME is there
                    var checkPattern = /SERVICE_(\d+)_NAME/g;
                    var checkMatch = checkPattern.exec(key);

                    //indice 1 of checkMatch contains the private port number
                    if(checkMatch){
                      port_names[checkMatch[1]] = input.metadata.labels[key]
                    }
                }
            }
            input.metadata.port_service_names = port_names
            resolve(input)
        }
    )
}

function checkForHealthCheckLabel(input){
    return new Promise(
        function(resolve,reject){

            //We create a structure like that
            //checks[port_number].id
            //checks[port_number].name
            //checks[port_number].http
            //...
            var checks = {};

            for (var key in input.metadata.labels) {
                if (input.metadata.labels.hasOwnProperty(key)) {

                    //Check if SERVICE_XXX_CHECK_HTTP is there
                    var checkPattern = /SERVICE_(\d+)_CHECK_HTTP/g;
                    var checkMatch = checkPattern.exec(key);

                    //indice 1 of checkMatch contains the private port number
                    if(checkMatch){

                        //stucture init for the captured port
                        if(!checks[checkMatch[1]])
                            checks[checkMatch[1]] = {};

                        var obj = jsonQuery('portMapping[privatePort=' + checkMatch[1] + ']', {
                            data: {"portMapping":input.metadata.portMapping}
                        });

                        checks[checkMatch[1]].id =  input.metadata.name + "_" + checkMatch[0];
                        checks[checkMatch[1]].name =  input.metadata.name + "_" + checkMatch[0];
                        checks[checkMatch[1]].http = "http://localhost:" + obj.value.publicPort + input.metadata.labels[key];
                        checks[checkMatch[1]].interval = "10s";
                        checks[checkMatch[1]].timeout = "1s";

                    }

                    //Then, check if SERVICE_XXX_CHECK_INTERVAL is there
                    var intervalPattern = /SERVICE_(\d+)_CHECK_INTERVAL/g;
                    var intervalMatch = intervalPattern.exec(key);

                    if(intervalMatch){

                        if(!checks[intervalMatch[1]])
                            checks[intervalMatch[1]] = {};

                        checks[intervalMatch[1]].interval =  input.metadata.labels[key];
                    }

                    //Then, check if SERVICE_XXX_CHECK_TIMEOUT is there
                    var timeoutPattern = /SERVICE_(\d+)_CHECK_TIMEOUT/g;
                    var timeoutMatch = timeoutPattern.exec(key);

                    if(timeoutMatch){

                        if(!checks[timeoutMatch[1]])
                            checks[timeoutMatch[1]] = {};

                        var obj = jsonQuery('portMapping[privatePort=' + timeoutMatch[1] + ']', {
                            data: {"portMapping":input.metadata.portMapping}
                        });

                        checks[timeoutMatch[1]].timeout =  input.metadata.labels[key];
                    }
                }
            }

             //Add checks in metadata for each port mapping
             input.metadata.portMapping.forEach(function(item){
                if(checks[item.privatePort])
                    item.Check = checks[item.privatePort];
             })

            resolve(input)
        }
    )
}

function cleanupServices() {
    return new Promise(
        function(resolve,reject) {
            
        }
    )
}

function registerService(input){
    return new Promise(
        function(resolve,reject){
            console.log("registerService: " + input.servicename);

            var serviceDefs = [];
            input.metadata.portMapping.forEach(function(pm) {

                var id = input.metadata.uuid + ":" + pm.publicPort;
                var name = _prefix + input.metadata.service_name;
                if (input.metadata.port_service_names[pm.privatePort] != undefined) {
                  name = _prefix + input.metadata.port_service_names[pm.privatePort]
                }
                if (pm.transport == "udp")
                    id += ":udp";

                if (input.metadata.portMapping.length > 1)
                    name += "-" + pm.privatePort;

                var definition = {
                    "ID": id, //<uuid>:<exposed-port>[:udp if udp]
                    "Name": name,
                    "Address": pm.address,
                    "Port": parseInt(pm.publicPort)
                };

                if (input.metadata.service_tags) {
                    definition.Tags = input.metadata.service_tags;
                }

                if(pm.Check){
                    definition.Check = pm.Check;
                }

                serviceDefs.push(definition)

            })

            async.map(serviceDefs,doRegister,function(err,results){
                if(err)
                    console.log(err);
                resolve(results)
            });
        }
    )
}

function deregisterService(input){
    return new Promise(
        function(resolve,reject){

            var uniqueIDs = [];

            input.metadata.portMapping.forEach(function(pm){
                var id = input.metadata.uuid + ":" + pm.publicPort;

                if(pm.transport == "udp")
                    id += ":udp";
                uniqueIDs.push(id)
            });

            async.map(uniqueIDs,doDeregister,function(err,results){
                if(err)
                    console.log(err);
                resolve(results)
            });
        }
    )
}

function doRegister(serviceDef,callback){
    var query = {
        "method":"PUT",
        "url": _consulAgent + "/v1/agent/service/register",
        "headers":{
            "Content-Type" : "application/json"
        },
        "json":serviceDef
    };

    request(query,function (error, response, body) {
        if (error) {
            callback("registerService error : " + error,null);
        }
        else{
            callback(null,serviceDef.ID + " registered")
        }
    });
}

function doDeregister(uuid,callback){
    var query = {
        "method":"GET",
        "url": _consulAgent + "/v1/agent/service/deregister/" + uuid,
    };

    request(query,function (error, response, body) {
        if (error) {
            callback(error,null)
        }
        else{
            callback(null,uuid +" Service deregistered");
        }
    });
}

function getServices(input){
    return new Promise(
        function(resolve,reject){
            var query = {
                "method":"GET",
                "url": _consulAgent + "/v1/agent/services",
            };

            request(query,function (error, response, body) {
                if (error) {
                    reject(error)
                }
                else{
                    var output = JSON.parse(body);

                    var allServiceIDs = Object.keys(output);
                    input.serviceIDs = [];
                    // figure out if these are services we registered
                    for (let id of allServiceIDs) {
                        if (re.test(id)) {
                            input.serviceIDs.push(id);
                        }
                    }
                    resolve(input);
                }
            });
        }
    )
}
