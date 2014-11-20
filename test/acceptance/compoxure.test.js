'use strict';

var expect = require('expect.js');
var async = require('async');
var request = require('request');
var http = require('http');
var cheerio = require('cheerio');
var config = require('../common/testConfig.json');
var stubServer = require('../common/stubServer');
var pcServer = require('../common/pcServer');

describe("Page Composer", function(){

    var pageComposer;

    this.timeout(5000);
    this.slow(3000);

    before(function(done){
        async.series([
            initStubServer,
            initPageComposer
        ], done);
    });

    function createEventHandler() {
        return {
            logger: function(level, message, data) {
            },
            stats: function(type, key, value) {
            }
        }
    }

    function initStubServer(next) {
        stubServer.init('pageComposerTest.html', 5001,'localhost')(next);
    }

    function initPageComposer(next) {
        pcServer.init(5000, 'localhost', createEventHandler())(next);
    }

    function getPageComposerUrl(path, search) {

        var url = require('url').format({
            protocol: 'http',
            hostname: 'localhost',
            port: 5000,
            pathname: path,
            search: search
        });

        return url;
    }

    it('should silently drop favicon requests', function(done) {
        request.get(getPageComposerUrl('favicon.ico'),{headers: {'accept': 'image/x-icon'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            done();
        });
    });

    it('should ignore requests for anything other than html', function(done) {
        request.get(getPageComposerUrl(),{headers: {'accept': 'text/plain'}}, function(err, response) {
            expect(response.statusCode).to.be(415);
            done();
        });
    });

    it('should process requests for any content type (thanks ie8)', function(done) {
        request.get(getPageComposerUrl(), {headers: {'accept': '*/*'}}, function(err, response, content) {
            expect(err).to.be(null);
            var $ = cheerio.load(content);
            expect($('#declarative').text()).to.be.equal('Replaced');
            done();
        });
    });

    it('should not die if given a poisoned url', function(done) {
        var targetUrl = getPageComposerUrl() + '?cid=271014_Primary-103466_email_et_27102014_%%%3dRedirectTo(%40RESOURCEURL1)%3d%%&mid=_&rid=%%External_ID%%&utm_source=ET&utm_medium=email&utm_term=27102014&utm_content=_&utm_campaign=271014_Primary_103466_%%%3dRedirectTo(%40RESOURCEURL1)%3d%%';
        request.get(targetUrl, {headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            done();
        });
    });

    it('should return a 404 if any of the fragments return a 404', function(done) {
        var requestUrl = getPageComposerUrl('404backend');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(404);
            done();
        });
    });

    it('should not return a 404 if of the fragments return a 404', function(done) {
        var requestUrl = getPageComposerUrl('ignore404backend');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            done();
        });
    });

    it('should return a 404 if the backend template returns a 404', function(done) {
        var requestUrl = getPageComposerUrl('404');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(404);
            done();
        });
    });

    it('should return a 500 if the backend template returns a 500', function(done) {
        var requestUrl = getPageComposerUrl('500');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(500);
            done();
        });
    });

    it('should return a 500 if the backend template returns no response at all', function(done) {
        var requestUrl = getPageComposerUrl('broken');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(500);
            done();
        });
    });

    it('should add no-store cache-control header if any fragments use cx-no-cache', function(done) {
        var requestUrl = getPageComposerUrl('noCacheBackend');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.headers['cache-control']).to.be.equal('no-store');
            done();
        });
    });

    it('should fail quietly if the backend is configured to do so', function(done) {
        var requestUrl = getPageComposerUrl('quiet');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response, content) {
            var $ = cheerio.load(content);
            expect($('#faulty').text()).to.be.equal('Faulty service');
            done();
        });
    });

    it('should fail loudly if the backend is configured to do so', function(done) {
        var requestUrl = getPageComposerUrl();
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response, content) {
            var $ = cheerio.load(content);
            expect($('#faulty').text()).to.be.equal('Error: Service http://localhost:5001/500 FAILED due to status code 500');
            done();
        });
    });

    it('should leave the content that was originally in the element if it is configured to do so', function(done) {
        var requestUrl = getPageComposerUrl('leave');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response, content) {
            var $ = cheerio.load(content);
            expect($('#faulty').text()).to.be.equal('Faulty service');
            done();
        });
    });

    it('should fail gracefully if the service returns no response at all', function(done) {
        getSection('', '', '#broken', function(text) {
            expect(text).to.be.equal('Error: Service http://localhost:5001/broken FAILED due to socket hang up');
            done();
        });
    });

    it('should remove the element if cx-replace-outer is set', function(done) {
        request.get(getPageComposerUrl(), {headers: {'accept': 'text/html'}}, function(err, response, content) {
            var $ = cheerio.load(content);
            expect($('#replace-outer-content').length).to.be.equal(0);
            expect($('#replace-outer').text()).to.be.equal('wrapping Replaced content');
            done();
        });
    });

    it('should ignore a cx-url that is invalid', function(done) {
        getSection('', '', '#invalidurl', function(text) {
            expect(text).to.be.equal('Error: Service invalid FAILED due to Invalid URL invalid');
            done();
        });
    });

    it('should ignore a cx-url that is invalid unless it is cache', function(done) {
        getSection('', '', '#cacheurl1', function(text) {
            expect(text).to.be.equal('');
            done();
        });
    });

    it('should ignore a cx-url that is invalid unless it is cache, and get the content if cache is primed', function(done) {
        getSection('', '', '#cacheurl2', function(text) {
            expect(text).to.be.equal('Replaced');
            done();
        });
    });

     it('should allow simple mustache logic', function(done) {
        getSection('', '?logic=yes', '#testlogic', function(text) {
            expect(text).to.be.equal('Logic ftw!');
            done();
        });
    });

    it('should have access to current environment', function(done) {
        getSection('', '', '#environment', function(text) {
            expect(text).to.be.equal('test');
            done();
        });
    });

    it('should not cache segments that return no-store in Cache-control header', function(done) {
        getSection('', '', '#no-store', function(text) {
            var before = text;
            setTimeout(function() {
                getSection('', '', '#no-store', function(text) {
                    expect(text).not.to.be.equal(before);
                    done();
                });
            }, 1);
        });
    });

    it('should pass no-store in Cache-control header from fragment response to client response', function(done) {
        request.get(getPageComposerUrl(), function(err, response) {
            expect(response.headers['cache-control']).to.be.equal('no-store');
            done();
        });
    });

    it('should honor max-age when sent through in fragments', function(done) {
        setTimeout(function() {
            getSection('', '', '#max-age', function(text) {
                setTimeout(function() {
                    getSection('', '', '#max-age', function(text2) {
                        expect(text2).to.be.equal(text);
                        setTimeout(function() {
                            getSection('', '', '#max-age', function(text3) {
                                expect(text3).not.to.be.equal(text);
                                done();
                            });
                        }, 1000);
                    });
                }, 50);
            });
        }, 1000); // Allow previous test cache to clear
    });

    it('should pass through non GET requests directly to the backend service along with headers and cookies', function(done) {
        var j = request.jar();
        var cookie = request.cookie('PostCookie=Hello');
        j.setCookie(cookie, getPageComposerUrl(),function() {
            request.post(getPageComposerUrl('post'), { jar: j, headers: {'accept': 'text/html'} }, function(err, response, content) {
                expect(content).to.be("POST Hello");
                done();
            });
        });
    });

    it('should NOT pass through GET requests that have text/html content type to a backend service', function(done) {
        request.get(getPageComposerUrl('post'), { headers: {'accept': 'text/html'} }, function(err, response, content) {
            expect(content).to.be("GET /post");
            done();
        });
    });

    it('should select the correct backend if a selectorFn is invoked', function(done) {
        request.get(getPageComposerUrl() + '?selectFn=true', {headers: {'accept': 'text/html'}}, function(err, response, content) {
            var $ = cheerio.load(content);
            expect($('#select').text()).to.be.equal("This is the backend selected by a selector fn");
            done();
        });
    });

    it('should use the handler functions to respond to a 403 status code', function(done) {
        request.get(getPageComposerUrl('403backend'), {headers: {'accept': 'text/html'}}, function(err, response, content) {
            expect(response.statusCode).to.be.equal(403);
            done();
        });
    });

    it('should pass x-tracer to downstreams', function(done) {
        var requestUrl = getPageComposerUrl('tracer');
        request.get(requestUrl,{headers: {'accept': 'text/html', 'x-tracer': 'willie wonka'}}, function(err, response) {
            expect(response.body).to.be('willie wonka');
            done();
        });
    });

    it('should retrieve bundles via the cx-bundle directive and cdn configuration using service supplied version numbers if appropriate', function(done) {
        var requestUrl = getPageComposerUrl('bundles');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            var $ = cheerio.load(response.body);
            var bundles = $('.bundle');
            expect($(bundles[0]).text()).to.be('100 >> service-one-top.js.html');
            expect($(bundles[1]).text()).to.be('default >> service-two-top.js.html');
            done();
        });
    });

    it('should use the target url to extract a default host if none provided in the backend config', function(done) {
        var requestUrl = getPageComposerUrl('nohost');
        request.get(requestUrl,{headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            expect(response.body).to.be('localhost');
            done();
        });
    });

    it('should only allow cookies to pass through that are whitelisted', function(done) {
        var requestUrl = getPageComposerUrl();
        var j = request.jar();
        j.setCookie(request.cookie('CompoxureCookie=Test'), getPageComposerUrl());
        j.setCookie(request.cookie('AnotherCookie=Test'), getPageComposerUrl());
        j.setCookie(request.cookie('TSLCookie=Test'), getPageComposerUrl());
        request.get(requestUrl, {jar: j, headers: {'accept': 'text/html'}}, function(err, response) {
            expect(response.statusCode).to.be(200);
            var $ = cheerio.load(response.body);
            var cookieValue = $('#cookie').text();
            expect(cookieValue).to.be('CompoxureCookie=Test; TSLCookie=Test');
            done();
        });
    });


    it('should create a default handler if none provided', function(done) {
        pcServer.init(5002, 'localhost')(function() {
            done();
        });
    });

    function getSection(path, search, query, next) {
        var url = getPageComposerUrl(path, search);
        request.get(url,{headers: {'accept': 'text/html'}}, function(err, response, content) {
            expect(err).to.be(null);
            var $ = cheerio.load(content);
            next($(query).text());
        });
    }

    function getSectionAuth(query, userId, next) {
        var j = request.jar();
        var cookie = request.cookie('TSLCookie=' + userId);
        j.setCookie(cookie, getPageComposerUrl());
        request.get(getPageComposerUrl(), { jar: j, headers: {'accept': 'text/html'} }, function(err, response, content) {
            expect(err).to.be(null);
            var $ = cheerio.load(content);
            next($(query).text());
        });
    }
});
