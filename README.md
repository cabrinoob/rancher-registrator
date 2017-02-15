### Instructions

Commande de lancement

    docker run -it --net=host -v /var/run/docker.sock:/var/run/docker.sock --label io.rancher.container.network=true --label io.rancher.container.dns=true  --name=docker-listener docker-listener
    
Le composant se connecte au fichier docker.sock local puis il écoute les évènements "start" et "stop" émis par le npm "docker-events"

#### On Start

sur le démarrage d'un conteneur, le workflow suivant s'éxecute :

    getMetaData(name)
    .then(filterMetaData)
    .then(checkForPortMapping)
    .then(checkForServiceIgnoreLabel)
    .then(checkForServiceNameLabel)
    .then(checkForHealthCheckLabel)
    .then(registerService)
    
Suite à l'émission de l'évènement, flying-potatoe récupère les méta-données de rancher, puis filtre ces méta-données en fonction du nom du conteneur qui vient d'arriver.
Ensuite, on vérifie si il comporte un mapping de ports. Si ce n'est pas le cas, on interrompt le processus. Par contre, si il y a un ou plusieurs ports mappés on poursuit en vérifiant si on a spécifié un label SERVICE_NAME.
Ensuite, on vérifie si il y a un SERVICE_CHECK de déclaré et enfin on enregistre le service dans consul.

#### Unique ID dans consul

Lorsqu'on enregistre un service dans consul on doit lui attribuer un identifiant unique. L'UUID du conteneur ne suffit pas car un même conteneur peut exposer plusiuers ports différents et il faudra donc créer plusieurs entrées dans consul.
En conséquence, l'identifiant unique d'un service est composé de la façon suivante :

    <uuid>:<exposed-port>[:udp if udp]

#### On Stop

sur l'arrêt d'un conteneur, le workflow suivant s'éxecute :

    getMetaData(name)
    .then(filterMetaData)
    .then(checkForPortMapping)
    .then(deregisterService)
    
Ici, flying-potatoe doit quand même faire appel à l'API de méta-données de rancher afin de reconsituer l'ID du ou des servicese à désenregistrer.