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
    console.log('init time: ', executeStart - initStart);

    last(function(){
        console.log(counter.count);
        var completedTime = Date.now();
        console.log('execute time: ', completedTime - executeStart);
        console.log('total time: ', completedTime - initStart);
        callback();
    });
}