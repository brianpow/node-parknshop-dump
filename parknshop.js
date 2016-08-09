'use strict'
var program = require("commander")
var toCSV = require('array-to-csv')
var slug = require("slug")
var mkdirp = require("mkdirp")
var querystring = require("querystring")
var http = require("http")
var async = require("async")
var fs = require("fs")
var path = require("path")
var cheerio = require("cheerio")
var URL = require("url")
var loaded = 0
var domain = "http://www.parknshop.com";
var categories = [],
    products = [],
    promotions = [],
    specialOffers = [],
    prmotionsAndSpecialOffers = [],
    others = []
var date = getLocalDate().toISOString().replace(/T.*/g, "")

var productHeaders = {
    'zt': "網頁連結	編號	圖片路徑	品牌	品牌	貨品名稱	貨品名稱	尺寸	建議售價	售價	備註	其他優惠	存貨	可買數量".split("\t"),
    'en': "url	id	image path	Brand	Brand	Name	Name	Size	Recommended Retail Price	Selling Price	Remark	Other promotions	Stock	Quantity you can buy".split("\t")
}
var specialOfferHeaders = {
    'zt': "額外折扣數量	額外折扣	平均單價".split("\t"),
    'en': "Bulk Quantities	Bulk Discount	Average Discounted Unit Price".split("\t")
}
var othersHeaders = {
    'zt': "最低平均售價	最大折扣	平均每一元買到的單位".split("\t"),
    'en': "Lowest Average Price	Discount	Unit per dollar".split("\t")
}
var promotionHeaders = {
    'zt': "推廣",
    'en': "promotion"
}
var finalHeaders = []
var outputFilename = date + "_complete.txt"


program.version('1.0.0')
    .option('-s, --save <filename>', 'save file as <filename>. (default is "' + outputFilename + '")')
    .option('-d, --debug', 'save debug file')
    .option('-v, --verbose', 'print more details', verbosity, 0)
    .option('-f, --force-download', "don't load cached webpages, always download from remote server")
    .option('-l, --limit <num>', "limit max simultaneous downloads. Default is 5.", parseInt, 5)
    .option('-n, --no-cache', "don't keep downloaded webpages")
    .option('-a, --language <lang>', "choose language (zt = Traditional Chinese, en = English)", /(zt|en)/, "zt")
    .option('-u, --user-agent <user-agent>', "set user-agent", /.+/, "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:47.0) Gecko/20100101 Firefox/47.0")
    .parse(process.argv)

http.globalAgent.maxSockets = program.limit;

banner()
process.stdout.write("Checking categories...")
httpdownload(domain, date + path.sep + "category" + path.sep + slug(domain, {
    replacement: "-"
}), getCategory, downloadProducts);

function verbosity(v, total) {
    return total + 1;
}

function httpdownload(url, filename, callback, finalCallback) {
    fs.exists(filename, (exists) => {
        if (program.forceDownload || !exists || exists && !fs.statSync(filename)["size"]) {
            if (program.verbose)
                console.log("Downloading " + url + " as " + filename)
            var p = path.parse(filename)
            mkdirp.sync(p.dir)
            _httpdownload(url, filename, callback, finalCallback)
        } else {
            if (program.verbose)
                console.log("Loading cached " + url + " named " + filename)
            loaded++
            var data = fs.readFileSync(filename, {
                encoding: "utf8"
            })

            if (data) {

                callback(data, url, finalCallback)

            }
        }
    })
}

function httpdownloadAsync(url, filename, callback) {
    fs.exists(filename, (exists) => {
        if (program.forceDownload || !exists || exists && !fs.statSync(filename)["size"]) {
            if (program.verbosity)
                console.log("Downloading " + url + " as " + filename)
            var p = path.parse(filename)
            mkdirp.sync(p.dir)
            _httpdownloadAsync(url, filename, callback)
        } else {
            if (program.verbosity)
                console.log("Loading cached " + url + " from " + filename)
            loaded++
            var data = fs.readFileSync(filename, {
                encoding: "utf8"
            })

            if (data) {
                callback(null, data)
            }
        }
    })
}

function downloadProducts(categories) {
    console.log(categories.length + " categories found.")
    process.stdout.write("Checking products...")
    async.each(categories, function(url, callback) {
        url = updateQueryString(url, {
            resultsForPage: 100
        })
        httpdownload(domain + url, date + path.sep + "products" + path.sep + slug(domain + url), getProducts, callback)
    }, function(err) {
        console.log(products.length + " products found.")
        downloadProductsDetails()
    })
}

function downloadProductsDetails() {

    var filename = date + "_products_only.txt"
    console.log("Basic products information saved to " + filename)
    fs.writeFileSync(filename, toCSV(products, "\t"))
    loaded = 0
    process.stdout.write("Checking special offer for each product (It may take up to 2 hours, be patient)...")

    async.each(products,
        function(product, calllback) {
            var url = product[0]
            var id = product[1]
            var urlPromotion = url + "/showAction?isQuickView=false&codeVarSel=" + id
            httpdownload({
                url: urlPromotion,
                method: "POST"
            }, date + path.sep + "details" + path.sep + slug(urlPromotion), getProductDetail, calllback)
        },
        function(err) {
            console.log("done.")
            process.stdout.write("Merging Products...")
            cleanUp()
            console.log("Exit now.")
        })
}

function getLocalDate(time) {
    var d = time ? new Date(time) : new Date;
    return new Date(d.getTime() - d.getTimezoneOffset() / 60);
}

function cleanUp() {
    process.stdout.write("saving to " + outputFilename + "...")
    fs.writeFileSync(outputFilename, toCSV(mergeProducts(products, specialOffers, promotions, others), "\t"))
    console.log("done.")
    if (program.debug) {
        var filename = date + "_special_offers_only.txt"
        fs.writeFileSync(filename, toCSV(specialOffers, "\t"))
        var filename = date + "_promotions_only.txt"
        fs.writeFileSync(filename, toCSV(promotions, "\t"))
        var filename = date + "_stocks_only.txt"
        fs.writeFileSync(filename, toCSV(others, "\t"))
    } else {
        var filename = date + "_products_only.txt"
        process.stdout.write("Removing " + filename + "...")
        fs.unlinkSync(filename);
        console.log("done.")
    }



}

function updateQueryString(url, newQuery) {
    var url2
    if (typeof url == "string") {
        url2 = URL.parse(url, true)
    }
    for (var i in newQuery) {
        url2.query[i] = newQuery[i]
    }

    url2.search = "?" + querystring.stringify(url2.query)
    url2.path = url2.pathname + url2.search
    return (typeof url == "string") ? url2.format(url2) : url2
}

function _httpdownloadAsync(url, filename, callback) {
    var res = function(response) {
        var str = ''
        response.on('data', function(chunk) {
            str += chunk
        })
        response.on('error', function(e) {
            console.log(e)
            callback(null, str)
        })
        response.on('end', function() {
            try {
                fs.writeFileSync(filename, str)
            } catch (e) {
                console.error(e)
            }
            callback(null, str)

        })
    }

    var url2
    var params = {}
    if (typeof url == "string")
        url2 = URL.parse(url, true)
    else {
        url2 = URL.parse(url.url, true)
        params = url
        delete params.url
    }

    try {

        var req = http.request(Object.assign({
            hostname: url2.hostname,
            port: url2.port,
            path: url2.path,
            method: 'GET',
            headers: {
                'User-Agent:': 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:47.0) Gecko/20100101 Firefox/47.0',
                'Cookie:': 'lang=' + program.language
            }
        }, params), res)
        req.on('error', function(e) {
            console.log(e);
            callback(e);
        }).end()

    } catch (e) {
        console.error("Error when downloading " + url)
        console.error(e)
        callback(e)
    }
}

function _httpdownload(url, filename, callback, finalCallback) {
    var res = function(response) {
        var str = ''
        response.on('data', function(chunk) {
            str += chunk
        })
        response.on('error', function(e) {
            console.log(e)
            callback(str, url, finalCallback)
        })
        response.on('end', function() {
            try {
                if (!program.noCache)
                    fs.writeFileSync(filename, str)
            } catch (e) {
                console.error(e)
            }
            callback(str, url, finalCallback)

        })
    }

    var url2
    var params = {}
    if (typeof url == "string")
        url2 = URL.parse(url, true)
    else {
        url2 = URL.parse(url.url, true)
        params = url
        delete params.url
    }

    try {

        var req = http.request(Object.assign({
            hostname: url2.hostname,
            port: url2.port,
            path: url2.path,
            method: 'GET',
            headers: {
                'User-Agent:': 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:47.0) Gecko/20100101 Firefox/47.0',
                'Cookie:': 'lang=' + program.language
            }
        }, params), res)
        req.on('error', function(e) {
            console.log(e);
            callback("", url, finalCallback);
        }).end()

    } catch (e) {
        console.error("Error when downloading " + url)
        console.error(e)
        finalCallback()
    }
}
var time = 0
var processed = 0

function getProductDetail(body, url, callback) {
    if (time == 0) time = (new Date).getTime()
    var $ = cheerio.load(body)
    var id = $("input[name=productCodePost]").attr("value")

    var promotion = [id]
    var specialOffer = [id]
    var other = [id]
    $("div.offer-table > div").each(function() {
        specialOffer = specialOffer.concat([$(this).attr("data-value"), $("span.offAmount", this).text().replace("HK$", "")])
    })
    if (specialOffer.length > 1)
        specialOffers.push(specialOffer)

    var re = new RegExp('>([^>]+)<\/a>', 'g'),
        result
    while (result = re.exec($("script").eq(5).text()))
        promotion.push(result[1])

    if (promotion.length > 1)
        promotions.push(promotion)
    var all = specialOffer.concat(promotion)
    prmotionsAndSpecialOffers.push(all)

    other = other.concat([$("#stockLevel").attr("value"), $("#maxOrderQuantity").attr("value")])

    others.push(other)
    processed++

    if (processed % 50 == 0) {

        if (loaded < processed) {
            var timeElapsed = (new Date).getTime() - time
            var timeleft = timeElapsed / (processed - loaded) * (products.length - processed)
            process.stdout.clearLine();
            process.stdout.cursorTo(0)
            process.stdout.write(products.length - processed + " products left, elapsed time: " + prettify(timeElapsed) + ", estimated remaining time: " + prettify(timeleft) + "/ " + timeleft.toFixed() + " seconds.")
        }
    }
    if (typeof callback == "function") callback(null, specialOffer, promotion, other)
    return [specialOffer, promotion, other]
}

function prettify(time, fmt) {
    fmt = fmt || "%Y years %m months %d days %h hours %i minutes %s seconds"
    var date = new Date(time)
    var str = []
    var Y = date.getUTCFullYear() - 1970
    var m = date.getUTCMonth()
    if (fmt.indexOf("%Y") == -1)
        m += Y * 12
    var d = date.getUTCDate() - 1
    var h = date.getUTCHours()
    if (fmt.indexOf("%d") == -1)
        h += d * 24
    var i = date.getUTCMinutes(),
        s = date.getUTCSeconds()
    if (Y) str.push(Y + " years")
    if (m || str.length) str.push(m + " months")
    if (d || str.length) str.push(d + " days")
    if (h || str.length) str.push(h + " hours")
    if (i || str.length) str.push(i + " minutes")
    if (s || str.length) str.push(s + " seconds")
    return str.join(" ")
}

function mergeProducts(products, specialOffers, promotions, others) {

    var mergedProducts = products.slice(0)
    var count = 0
    var count2 = 0
    for (var i in specialOffers)
        count = (count < specialOffers[i].length) ? specialOffers[i].length - 1 : count
    count = count / 2 * 3
    for (var i in promotions)
        count2 = (count2 < promotions[i].length) ? promotions[i].length - 1 : count2

    finalHeaders = productHeaders[program.language];
    for (var i = 0; i < count / 3; i++)
        finalHeaders = finalHeaders.concat(specialOfferHeaders[program.language]);
    finalHeaders = finalHeaders.concat(othersHeaders[program.language])
    for (var i = 0; i < count2 / 3; i++)
        finalHeaders = finalHeaders.concat(promotionHeaders[program.language]);
    for (var i in mergedProducts) {
        var match = false
        var minPrice = mergedProducts[i][9]
        for (var j in others)
            if (mergedProducts[i][1] == others[j][0]) {
                mergedProducts[i] = mergedProducts[i].concat(others[j].slice(1))
                break
            }

        for (var j in specialOffers)
            if (mergedProducts[i][1] == specialOffers[j][0]) {
                var tmp = specialOffers[j].slice(1)
                while (tmp.length) {
                    var tmp2 = tmp.slice(0, 2)
                    var specialOfferPrice = Number(mergedProducts[i][9]) - (Number(tmp[1]) / Number(tmp[0]))
                    tmp2.push(specialOfferPrice)

                    if (specialOfferPrice < minPrice)
                        minPrice = specialOfferPrice
                    mergedProducts[i] = mergedProducts[i].concat(tmp2)
                    tmp = tmp.slice(2)
                }
                for (var k = 0; k < count - (specialOffers[j].length - 1) / 2 * 3; k++)
                    mergedProducts[i].push("'-")
                match = true
                break
            }
        if (!match)
            for (var k = 0; k < count; k++)
                mergedProducts[i].push("'-")
        mergedProducts[i].push(minPrice)
        mergedProducts[i].push((1 - minPrice / mergedProducts[i][9]) * 100 + "%")

        var size = 1

        var parsedSize = mergedProducts[i][7].replace("BOX", "").replace(/[^0-9xX\.]/g, "").replace(/[xX]/g, "*")

        if (parsedSize.match(/^[\d\*]+$/g))
            try {
                size = eval(parsedSize)
            } catch (e) {
                console.error(mergedProducts[i][7], parsedSize)
            }
        mergedProducts[i].push(minPrice / size)

        match = false
        for (var j in promotions)
            if (mergedProducts[i][1] == promotions[j][0]) {
                var tmp = promotions[j].slice(1)
                mergedProducts[i] = mergedProducts[i].concat(tmp)
                for (var k = 0; k < count2 - tmp.length; k++)
                    mergedProducts[i].push("'-")
                match = true
                break
            }
        if (!match)
            for (var k = 0; k < count2; k++)
                mergedProducts[i].push("'-")
    }
    return [finalHeaders].concat(mergedProducts);
}

function getProducts(body, url, callback) {

    var $ = cheerio.load(body),
        product = []
    var brands = $("ul.catList").last().find("span.rightSpan").map(function() {
        return $(this).text().trim()
    }).get()
    $("div.productCol").each(function(i, el) {
        var uri = $(el).find("dd > a").eq(0).attr("href").trim().split("/")

        product = [
            domain + $(el).find("dd > a").eq(0).attr("href").trim(),
            uri[4].match("\\d+$"),
            $(el).find("dd > a img").eq(0).attr("src").trim(),
            $(el).find("dt > strong").eq(0).text().trim(),
            uri[1].substr(8),
            uri[2],
            $(el).find("dd > a img").eq(0).attr("alt").replace(/-BP_\d+$/, ""),
            $(el).find("dt > span.colorGray").eq(0).text().trim(),
            $(el).find(".priceWrapper b").eq(0).text().replace("HK$", "").replace(",", "").trim(),
            $(el).find(".priceWrapper strong").eq(0).text().replace("HK$", "").replace(",", "").trim(),
            $(el).find("div").eq(0).text().trim(),
            $(el).find("dl.SpecialPro").map(function() {
                return $(this).text().trim()
            }).filter(function() {
                return this.trim().length;
            }).get().join(",")
        ]
        if (product[3].substr(-3, 3) == "...") {
            var tmp = product[3].substr(0, product[3].length - 3)
            brands.forEach(function(brand) {
                if (brand.indexOf(tmp) == 0) {
                    product[3] = brand
                    return false
                }
            })
        }
        products.push(product)
    })
    var nextUrl = $("a.iconNext").eq(0).attr("href")
    if (nextUrl) {
        if (nextUrl != "javascript:void(0);") {
            httpdownload(domain + nextUrl, date + path.sep + "products" + path.sep + slug(domain + nextUrl, "-"), getProducts, callback)
        } else {
            callback()
        }
    } else {
        callback()
    }
}

function getCategory(data, url, callback) {
    var $ = cheerio.load(data)
    var categories = $("div.category a[href]").map(function() {
        return this.attribs["href"];
    }).get()
    callback(categories)
}

function banner() {
    console.log("ParkNShop price dumping script")
}