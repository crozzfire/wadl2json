wadl2json
=========

Convert a remote WADL file into a JSON equivalent. See the [swagger spec](https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md) for further information about the format of the JSON returned.

How to use it
-------------

You can parse a WADL string, a WADL file, or a remote WADL file:

```js
var wadl2json = require("wadl2json");

var options = {
  sort: false, // set it to true if you want to sort operations and verbs in the alphabetical order
  stringify: false, // set it to true if you want to get a string instead of an object
  prettify: false, // set it to true if you want to get an indented string (stringify=true required)

  title: "Simple API", // the title of the API (required)
  description: "Simple API description", // the description of the API (required)
  version: "1.4.2", // the version of the API (required)

  apiKey: ["MyAPIKey"], //Required API Key 
  basicAuthHeader: "Auth-Header-To-Map", //Basic Auth Header that will be mapped in the integration
  CORS: true, // Enable CORS for all endpoints
  httpProxy: true, //Proxy all the given endpoints 
  
  blacklist: ["/internal"] // the path roots you want to blacklist
};

var swaggerFromString = wadl2json.fromString("<wadl content>", options);
var swaggerFromFile = wadl2json.fromFile("./wadl-content.wadl", options);
var swaggerFromURL = wadl2json.fromURL("http://example.com/application.wadl", options);
```

How to build
------------

Please install [node](http://nodejs.org/) and [npm](https://www.npmjs.org/) on your system.
Then:

```
cd /path/to/wadl2json
npm install
```

Note that you can also install the lib globally (with -g flag) as:

```
cd /path/to/wadl2json
npm install -g
```


TODOS
_____

The tests have become inconsistent after adding several features. The code needs to be refactored a bit and new tests are to be written.