module.exports = function(){
    function run(callback){
        run.count++;
        setTimeout(callback, 0);
    };

    run.count = 0;

    return run;
};