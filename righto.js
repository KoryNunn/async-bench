var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var last = righto(counter);

    for(var i = 0; i < iterations; i++){
        last = righto(counter, righto.after(last));
    }

    var executeStart = Date.now();
    var initTime = (executeStart - initStart);

    last(function(){

        var completedTime = Date.now();
        var executeTime = (completedTime - executeStart);

        callback(null, {initTime, executeTime})
    });
}