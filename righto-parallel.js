var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var tasks = [];

    for(var i = 0; i < iterations; i++){
        tasks.push(righto(counter));
    }

    var doAll = righto.all(tasks);

    var executeStart = Date.now();
    var initTime = (executeStart - initStart);

    doAll(function(){

        var completedTime = Date.now();
        var executeTime = (completedTime - executeStart);

        callback(null, {initTime, executeTime})
    });
}