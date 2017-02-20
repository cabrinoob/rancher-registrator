### Introduction
The aim of this project is to achieve a third party registration in consul for every containers deployed through rancher. Since the release of Rancher v1.2.0 and its migration to the CNI framework, registrator is'nt able to see containers port mappings anymore.

Rancher-registrator relies on the docker.sock and the rancher metadata API to do its job.

### Requierments & limitations
Rancher-registrator is made to run in a container on each host of your infrastructure. It needs to be deployed alongside a local consul-agent to register its services.

For now, Rancher-registrator only registers its service into Consul backend. **Etcd and Zookeeper are'nt yet supported**.

### Instructions

Rancher-registrator is made to be launched from **Rancher**. It needs to be started in networking mode "host" and with 2 rancher labels : 

 - -l io.rancher.container.network=false
 - -l io.rancher.container.dns=true

It also needs to be mapped on the docker.sock file of the host :

 - -v /var/run/docker.sock:/var/run/docker.sock

**launch command**

    docker run -it --net=host -v /var/run/docker.sock:/var/run/docker.sock --label io.rancher.container.network=false --label io.rancher.container.dns=true  --name=registrator rancher-registrator


**Optional environment vars**

You can set 2 environment variables :

 - SVC_PREFIX is used to prefix the service name into consul (for testing purpose)
 - LOCAL_CONSUL_AGENT defaults to "http://localhost:8500" and it can be changed if necessary.

### Labels

We have ported the very basic labels offered by the original registrator : 

**SERVICE_NAME** : Allows you to override the service name registered in consul

**SERVICE_IGNORE** : Set to true, it allows you to ignore the service registration.

**SERVICE_TAGS**: An comma-delimited list of strings used as tags in consul. (note : JSON is not allowed for now)

**SERVICE_[private_port]_CHECK_HTTP** : Allows you to declare an healthcheck at the same time you register your service in consul. The value of this label is the path to check. Exemple :

    SERVICE_9000_CHECK_HTTP = /api/ping

**SERVICE_[private_port]_CHECK_INTERVAL** : Defines the frequency of the healthCheck. The default value is 10s. 

**SERVICE_[private_port]_CHECK_TIMEOUT** : Defines the timeout from which the healthcheck is considered as "not passing".
