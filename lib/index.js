
/**
 * TODO: Remove `mkdirp`. Use `fs-extra` instead.
 */

var path        = require("path")
var fs          = require("fs-extra")
var pkg         = require('../package.json')
var polymer     = require('terraform')
var helpers     = require("./helpers")
var async       = require("async")
var connect     = require("connect")
var middleware  = require("./middleware")
var mime        = require('mime')


/**
 * Server
 *
 * Host a single Harp Application.
 *
 */

exports.server = function(dirPath, options, callback){
  connect.createServer(
    middleware.regProjectFinder(dirPath),
    middleware.setup,
    middleware.underscore,
    middleware.mwl,
    middleware.static,
    middleware.poly,
    middleware.process,
    middleware.fallback
  ).listen(options.port || 9966, callback)
}


/**
 * Multihost
 *
 * Host a single Harp Application.
 *
 */

exports.multihost = function(dirPath, options, callback){
  connect.createServer(
    middleware.notMultihostURL,
    middleware.index(dirPath),
    middleware.hostProjectFinder(dirPath),
    middleware.setup,
    middleware.underscore,
    middleware.mwl,
    middleware.static,
    middleware.poly,
    middleware.process,
    middleware.fallback
  ).listen(options.port || 9966, callback)
}

/**
 * Mount
 *
 * Offer the asset pipeline as connect middleware
 *
 */

exports.mount = function(mountPoint, root){

  if(!root){
    root = mountPoint
    mountPoint = null
  }else{
    var rx = new RegExp("^" + mountPoint)
  }

  var finder = middleware.regProjectFinder(root)

  return function(req, rsp, next){

    if(rx){
      if(!req.url.match(rx)) return next()
      var originalUrl = req.url
      req.url         = req.url.replace(rx, "/")
    }

    finder(req, rsp, function(){
      middleware.setup(req, rsp, function(){
        middleware.static(req, rsp, function(){
          middleware.poly(req, rsp, function(){
            middleware.process(req, rsp, function(){
              middleware.process(req, rsp, function(){
                if(originalUrl) req.url = originalUrl
                next()
              })
            })
          })
        })
      })
    })
  }
}


/**
 * Pipeline
 *
 * Offer the asset pipeline as connect middleware
 *
 */

exports.pipeline = function(root){
  var publicPath = path.resolve(root)
  var poly = polymer.root(publicPath)

  return function(req, rsp, next){
    var normalizedPath  = helpers.normalizeUrl(req.url)
    var priorityList    = polymer.helpers.buildPriorityList(normalizedPath)
    var sourceFile      = polymer.helpers.findFirstFile(publicPath, priorityList)

    if(!sourceFile) return next()

    poly.render(sourceFile, function(error, body){
      if(error){
        console.log(error)
        next()
      }else{
        if(!body) return next() // 404

        var outputType = polymer.helpers.outputType(sourceFile)
        var mimeType   = helpers.mimeType(outputType)
        var charset    = mime.charsets.lookup(mimeType)
        rsp.statusCode = 200
        rsp.setHeader('Content-Type', mimeType + (charset ? '; charset=' + charset : ''))
        rsp.setHeader('Content-Length', body.length)
        rsp.end(body)
      }
    })

  }

}


/**
 * Compile
 *
 * Compiles Single Harp Application.
 *
 */

exports.compile = function(projectPath, outputPath, callback){

  /**
   * Both projectPath and outputPath are optional
   */

  if(!callback){
    callback   = outputPath
    outputPath = "www"
  }

  if(!outputPath){
    outputPath = "www"
  }


  /**
   * Setup all the paths and collect all the data
   */

  try{
    outputPath = path.resolve(projectPath, outputPath)
    var setup  = helpers.setup(projectPath, "production")
    var poly   = polymer.root(setup.publicPath, setup.config.globals)
  }catch(err){
    return callback(err)
  }


  /**
   * Protect the user (as much as possible) from compiling up the tree
   * resulting in the project deleting its own source code.
   */

  if(!helpers.willAllow(projectPath, outputPath)){
    return callback({
      type: "Invalid Output Path",
      message: "Output path cannot be greater then one level up from project path and must be in directory starting with `_` (underscore).",
      projectPath: projectPath,
      outputPath: outputPath
    })
  }


  /**
   * Compile and save file
   */

  var compileFile = function(file, done){
    poly.render(file, function(error, body){
      if(error){
        done(error)
      }else{
        if(body){
          var dest = path.resolve(outputPath, polymer.helpers.outputPath(file))
          fs.mkdirp(path.dirname(dest), function(err){
            fs.writeFile(dest, body, done)
          })
        }else{
          done()
        }
      }
    })

  }


  /**
   * Copy File
   *
   * TODO: reference ignore extensions from a terraform helper.
   */
  var copyFile = function(file, done){
    var ext = path.extname(file)
    if(!polymer.helpers.shouldIgnore(file) && [".jade", ".ejs", ".md", ".styl", ".less", ".coffee"].indexOf(ext) === -1){
      var localPath = path.resolve(outputPath, file)
      fs.mkdirp(path.dirname(localPath), function(err){
        fs.copy(path.resolve(setup.publicPath, file), localPath, done)
      })
    }else{
      done()
    }
  }

  /**
   * Scan dir, Compile Less and Jade, Copy the others
   */

  helpers.prime(outputPath, { ignore: projectPath }, function(err){
    if(err) console.log(err)

    helpers.ls(setup.publicPath, function(err, results){
      async.eachLimit(results, 72, compileFile, function(err){
        if(err){
          callback(err)
        }else{
          async.eachLimit(results, 72, copyFile, function(err){
            setup.config['harp_version'] = pkg.version
            delete setup.config.globals
            callback(null, setup.config)
          })
        }
      })
    })
  })

}

