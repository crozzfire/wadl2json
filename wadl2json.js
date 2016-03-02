var util = require('util');

/**
 * A module generating a JSON representation of a WADL content
 * @module wadl2json
 */
(function() {
  var fs = require("fs");
  var request = require("request");
  var url = require("url");

  var _ = require("lodash");
  var parser = require("xml2json");
  var beautify = require("js-beautify").js_beautify;

  var wadl2json = exports;

  wadl2json._defaultOptions = {
    prettify:   false,
    sort:       false,
    stringify:  false
  };

  wadl2json.options = {};

  //Util
  var base = {};

  function createUrl (base, path) {      
    if (!path.length)
      return _.trimRight(base);

    if (!base.length)
      return _.trimRight(path);

    return _.trimRight(base,"/") + "/" + _.trim(path,"/");
  }

  function hasOption (option) {
    if (option in wadl2json.options === false) 
      return false;

    //falsy
    if (!wadl2json.options[option]) 
      return false;

    if (_.isObject(wadl2json.options[option]) && _.isEmpty(wadl2json.options[option]))
      return false;

    return true;    
  }

  function convertWadlParamType (prefixedType) {
    var type = prefixedType.split(":")[1] || prefixedType.split(":")[0];
    return (type == "int" || type == "long")  ? "integer" : type;
  }

  function isParamRequired (style) {
    if (style == "header")
      return true;

    if (style == "template")
      return true;

    return false;
  }

  /**
   * Extract all methods from a parsed WADL content
   * @private
   * @param {object} resource - WADL <resource> tag
   * @returns {array} all methods contained in resource
   */
 exports._methodsFromWADLResource = function(basePath, resource) {
    
    var path = createUrl(basePath,resource.path);
    var fullPath = createUrl(base.href, path);

    var methods = _.map(resource.method || [], function(method) {

    var request = method && method.request && method.request[0];

    var params = (resource.param || [])
              .concat(request && request.param || [])
              .concat(request && request.representation && request.representation[0] && request.representation[0].param || []);        
    
    var responses = {};  
    var integration = {};      
    var security = [];
    var hasIntegration = false;

    //Check if Basic Auth is needed and concat it every method for now  
    if (hasOption("basicAuthHeader")) {  

      var headerName = wadl2json.options.basicAuthHeader;

      params.push({
          "type": 'xs:string',
          "style": 'header',
          "name": headerName
        });

      integration = _.merge(integration, {
        "requestParameters": {
          "integration.request.header.Authorization": "method.request.header." + headerName
        }
      });

      hasIntegration = true;
    }         
    
    //Check if API key is needed
    if (hasOption("apiKey")) {
        security = [{
          "api_key": wadl2json.options.apiKey
        }];
    }

    //Is CORS enabled?
    if (hasOption("CORS")) {
      responses = {          
        "200": {
          "description": "200 response",
          "headers": {
            "Access-Control-Allow-Origin": {
              "type": "string"
            }
          }
        }          
      };

      integration = _.merge(integration , {
        "responses": {
          "default": {
            "statusCode": "200",
            "responseParameters": {
              "method.response.header.Access-Control-Allow-Origin": "'*'"
            }
          }
        }
      });

      hasIntegration = true;                  
    }
      
    //has httpProxy?
    if (hasOption("httpProxy")) {
       integration = _.merge(integration , {
        "responses": {
          "default": {
              "responseTemplates": {
                "application/json": "__passthrough__"
              }
            }
          }
        });

       hasIntegration = true;                  
    }

    if (hasIntegration) {
      integration = _.merge(integration,{
        "uri": fullPath,
        "httpMethod": method.name,
        "type": base.protocol.replace(/:$/, "")
      });
    }  
   
    return {
      'verb': method.name,
      'name': method.id,
      'params': params,
      'path': path,
      'security': security,
      'integration': integration,
      'responses': responses

    };
  });

    return methods.concat(_.map(resource.resource || [], _.partial(wadl2json._methodsFromWADLResource,  path)));
  };

  /**
   * Group methods by path
   * @private
   * @param {array} methods - methods returned by _methodsFromWADLResource
   * @returns {object} methods grouped by path
   */
  exports._groupMethodsByPath = function(methods) {
    var methodsByPath = _.groupBy(methods, "path");
    var paths = _.chain(methodsByPath).keys().sortBy().value();

    return _.foldl(paths, function(methods, path) {
      var methodsByVerb = _.groupBy(methodsByPath[path], "verb");
      var verbs = _.chain(methodsByVerb).keys().sortBy().value();

      return _.foldl(verbs, function(methods, verb) {
        var sortedOperations = _.sortBy(methodsByVerb[verb], "name");

        methods[path] = methods[path] || {};                        
        
        methods[path][verb.toLowerCase()] = {};        
        
        methods[path][verb.toLowerCase()].responses = sortedOperations[0].responses || {};          
          
        methods[path][verb.toLowerCase()].parameters = (function() {

            var params = _.chain(sortedOperations)
              .pluck("params")
              .flatten(true)
              .uniq("name")
              .map(function(param) {
                return {
                  "name": param.name,
                  "required": isParamRequired(param.style),
                  "in": ({template: "path", plain: "body"})[param.style] || param.style,
                  "type": convertWadlParamType(param.type)
                };
              })
              .value();

            if(_.size(params) > 0) {
              return params;
            }
          })();

        //Add security if required
        if (hasOption("apiKey") && !_.isEmpty(sortedOperations)) {          

          methods[path][verb.toLowerCase()].security = sortedOperations[0].security;           
          
          //Add options method
          if (!_.has(methods[path], "options")) {            
            var allowedHeaders = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key," + wadl2json.options.basicAuthHeader+ "'";
            var optionsParamsGet = _.chain(_.get(methods, '['+path+']["get"]["parameters"]', false))
                            .filter(function(param) {
                                  return param.name != wadl2json.options.basicAuthHeader;
                            })
                            .value();
                            
            var optionsParamsPost =_.chain(_.get(methods, '['+path+']["post"]["parameters"]', false))
                            .filter(function(param) {
                                  return param.name != wadl2json.options.basicAuthHeader;
                            })
                            .value();

            var optionsParamsPut = _.chain(_.get(methods, '['+path+']["put"]["parameters"]', false))
                            .filter(function(param) {
                                  return param.name != wadl2json.options.basicAuthHeader;
                            })
                            .value();

            var optionsParamsDelete = _.chain(_.get(methods, '['+path+']["delete"]["parameters"]', false))
                            .filter(function(param) {
                                  return param.name != wadl2json.options.basicAuthHeader;
                            })
                            .value();

            var optionsParams = (_.isEmpty(optionsParamsGet) ? false : optionsParamsGet) ||
                                (_.isEmpty(optionsParamsPost) ? false : optionsParamsPost) ||
                                (_.isEmpty(optionsParamsPut) ? false : optionsParamsPut) ||
                                (_.isEmpty(optionsParamsDelete) ? false : optionsParamsDelete);                                                                                                                                                                          

            methods[path].options = {
              "produces": [
                "application/json"
              ],
              "parameters": optionsParams? optionsParams: [],
              "responses": {
                "200": {
                  "description": "200 response",
                  "schema": {
                    "$ref": "#/definitions/Empty"
                  },
                  "headers": {
                    "Access-Control-Allow-Origin": {
                      "type": "string"
                    },
                    "Access-Control-Allow-Methods": {
                      "type": "string"
                    },
                    "Access-Control-Allow-Headers": {
                      "type": "string"
                    }
                  }
                }
              },
              "security": [
                {
                  "api_key": wadl2json.options.apiKey
                }
              ],
              "x-amazon-apigateway-integration": {
                "responses": {
                  "default": {
                    "statusCode": "200",
                    "responseParameters": {
                      "method.response.header.Access-Control-Allow-Methods": "'GET,OPTIONS,PUT'",
                      "method.response.header.Access-Control-Allow-Headers": allowedHeaders,
                      "method.response.header.Access-Control-Allow-Origin": "'*'"
                    },
                    "responseTemplates": {
                      "application/json": "__passthrough__"
                    }
                  }
                },
                "requestTemplates": {
                  "application/json": "{\"statusCode\": 200}"
                },
                "type": "mock"
              }
            };
          }
        }

        //Add integration
        if (!_.isEmpty(sortedOperations))
          methods[path][verb.toLowerCase()]["x-amazon-apigateway-integration"] = sortedOperations[0].integration;  
        
        return methods;

      }, methods);
    }, {});
  };

  /**
   * Generate a JSON representation from parsed WADL content
   * @param {object} wadlJson - object representing wadl content
   * @param {object} [options] - options
   * @returns {object|string} JSON representation of given WADL content
   */
  exports.fromJSON = function(wadlJson, options) {

    wadl2json.options = _.extend({}, wadl2json._defaultOptions, options);
    
    var app = wadlJson && wadlJson.application && wadlJson.application[0];
    var resources = app && app.resources && app.resources[0];
    base = resources && resources.base && require("url").parse(resources.base);
        
    var methods = _.chain(resources && resources.resource)
      .map(_.partial(wadl2json._methodsFromWADLResource, ""))
      .flatten(true)
      .filter(function(method) {
        return _.all(wadl2json.options.blacklist, function(path) {          
          return method.path.indexOf(path) !== 0;
        });
      })
      .value();

    var methodsByPath = wadl2json._groupMethodsByPath(methods);

    var json = {};
    json.swagger = "2.0";

    json.schemes = [base.protocol.replace(/:$/, "")];
    json.host = base.host;
    json.basePath = base.path.replace(/\/$/, "");

    json.paths = methodsByPath;

    json.info = {
      title: wadl2json.options.title || "",
      version: wadl2json.options.version || "",
      description: wadl2json.options.description || ""
    };

    if(hasOption("apiKey")) {
       json.securityDefinitions =  {
          "api_key": {
            "type": "apiKey",
            "name": "x-api-key",
            "in": "header"
          }
        };        

        json.definitions = {
          "Empty": {}
        };               
    }

    json = options.stringify ? JSON.stringify(json) : json;
    json = options.stringify && options.prettify ? beautify(json, {indent_size: 2}) : json;

    return json;
  };

  /**
   * Generate a JSON representation from raw WADL content
   * @param {string} wadlString - raw WADL content
   * @param {object} [options] - options
   * @returns {object|string} JSON representation of given WADL content
   */
  exports.fromString = function(wadlString, options) {
    /* Remove XML header as xml2json is not able to parse it */
    wadlString = wadlString.replace(/<\?[^<]*\?>/g, "");
    var wadlJson = parser.toJson(wadlString, {
      object: true,
      arrayNotation: true
    });

    return wadl2json.fromJSON(wadlJson, options);
  };

  /**
   * Generate a JSON representation from a WADL file
   * @param {string} filename - name of a file containing WADL content
   * @param {object} [options] - options
   * @returns {object|string} JSON representation of given WADL content
   */
  exports.fromFile = function(filename, options) {
    var wadlString = fs.readFileSync(filename).toString();

    return wadl2json.fromString(wadlString, options);
  };

  /**
   * @callback requestCallback
   * @param {object} error - Forwarded error if unreachable content or generation fail. May be null.
   * @param {object|string} JSON representation of given WADL content
   */

  /**
   * Generate a JSON representation from a remote WADL file
   * @param {string} wadlURL - url of remote WADL content
   * @param {requestCallback} callback - function called on process end
   * @param {object} [options] - options
   */
  exports.fromURL = function(wadlURL, callback, options) {
    var opt = {
      uri: wadlURL
    };

    if(wadlURL.indexOf("https://") === 0) {
      opt.agent = new (require("https").Agent)({
        keepAlive: true
      });
    }

    request(opt, function(err, res, body) {
      if(err) {
        callback(err);
      }
      else {
        callback(null, wadl2json.fromString(body, options));
      }
    });
  };
})();
