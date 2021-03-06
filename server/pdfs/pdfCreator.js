var fs = require('fs');
var glob = require('glob');
var objToHtml = require('../utils/esfHtml');
var phantom = require('phantom');
var async = require('async');
var archiver = require('archiver');
var invoicesSoap = require('../invoices/invoiceSoap');

module.exports = {
  order: function(params, callback) {
    invoicesSoap.queryInvoiceById(params, function(err, result) {
      console.log(result);
      
      if (err) { return callback(err, null) }

      function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
      }
      var orderId = getRandomInt(100000000, 999999999);

      var session = null;

      process.on('exit', function(code, signal) {
        session.exit();
      });

      var createPhantomSession = function(cb) {
        if (session) {
          return cb(null, session);
        } else {
          phantom.create().then(function(_session){
            session = _session;
            return cb(null, session);
          });
        }
      };

      var renderPdf = function(session, pdfContent, pdfFilename, callback, cb) {
        var page;

        try {
          session.createPage().then(function(_page) {
            page = _page;
            page.on('onLoadFinished', function() {
              page.render(pdfFilename).then(function() {
                page.close();
                page = null;
                callback();
                return cb(null, pdfFilename);
              });
            });
            page.property('paperSize', { width: 8.5*122, height:11*122, margin:{ top: 50, bottom: 50} });
            page.property('content', pdfContent);
          });
        } catch(e) {
          try {
            if (page != null) {
              callback();
              page.close(); // try close the page in case it opened but never rendered a pdf due to other issues
            }
          } catch(e) {
            callback();
            // ignore as page may not have been initialised
          }
          callback();
          return cb('Exception rendering pdf:' + e.toString());
        }
      };
      
      createPhantomSession(function(err,s) {
        async.forEachLimit(params.idList, 50, function(invoiceId, callback){
          var length = result.invoiceInfoList.invoiceInfo.length;
          var invoiceInfo = {};
          for (var i=0; i < length; i++) {
            if (result.invoiceInfoList.invoiceInfo[i].invoiceId === invoiceId) {
              invoiceInfo = result.invoiceInfoList.invoiceInfo[i];
              break;
            }
          }
          var filename = './print/' + orderId + '/' + invoiceInfo.registrationNumber + '.pdf';
          renderPdf(s, objToHtml(invoiceInfo), filename, callback, function(err, f){
            if (err) console.log(err);
            console.log(f);
          });
        }, function(err){
          if (err) throw err;
          callback(null, orderId);
        });
      });
    })
  },
  download: function(orderId, callback) {
    var archive = archiver('zip');
    archive.on('error', function(err) {
      throw err;
    });
    archive.on('end', function(err) {
        glob("./print/"+ orderId +"/*.*",function(err,files){
             if (err) throw err;
            async.forEach(files,function(item, callback){
                fs.unlink(item, function(err){
                    if (err) throw err;
                    callback();
                });
            },function(){
                if (err) throw err;
                fs.rmdirSync("./print/"+ orderId);
            });
        });
    });
    callback(null, archive);
    glob("./print/" + orderId + "/*.pdf",function(err,files){
        if (err) throw err;
        async.forEach(files,function(item, callback){
            archive.append(fs.createReadStream(item), { name: item.replace('./print/' + orderId + '/', '') });
            callback();
        },function(){
            if (err) throw err;
            archive.finalize();
        });
    });
  }
}