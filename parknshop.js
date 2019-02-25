'use strict'
var program = require('commander')
var toCSV = require('array-to-csv')
var mkdirp = require('mkdirp')
var querystring = require('querystring')
//var http = require('http')
//var RateLimiter = require('limiter').RateLimiter;
var async = require('async')
var fs = require('fs')
var path = require('path')
var cheerio = require('cheerio')
var request = require('request') 
request.defaults({jar: true})
var throttledRequest = require('throttled-request')(request);
var URL = require('url')
var loaded = 0
var stage = 0
var domain = 'https://www.parknshop.com'
var categories = [],
  products = {},
  promotions = {},
  specialOffers = {},
  others = {}
var date = getLocalDate().toISOString().replace(/T.*/g, '')

var productHeaders = {
  'zh-hk': '網頁連結\t編號\t圖片路徑\t品牌\t品牌\t貨品名稱\t貨品名稱\t尺寸\t建議售價\t售價\t優惠\t可買數量'.split('\t'),
  // 'en': 'url\tid\timage path\tBrand\tBrand\tName\tName\tSize\tRecommended Retail Price\tSelling Price\tRemark\tOther promotions\tStock\tQuantity you can buy'.split('\t')
  'en': 'url\tid\timage path\tBrand\tBrand\tName\tName\tSize\tRecommended Retail Price\tSelling Price\tSpecial Offer\tQuantity you can buy'.split('\t')

}
var specialOfferHeaders = {
  'zh-hk': '額外折扣數量\t額外折扣\t平均單價'.split('\t'),
  'en': 'Bulk Quantities\tBulk Discount\tAverage Discounted Unit Price'.split('\t')
}
var othersHeaders = {
  'zh-hk': '最低平均售價\t最大折扣\t平均每一元買到的單位'.split('\t'),
  'en': 'Lowest Average Price\tDiscount\tUnit per dollar'.split('\t')
}
var promotionHeaders = {
  'zh-hk': '推廣',
  'en': 'promotion'
}
var finalHeaders = []
var outputFilename = date + '_complete.txt'
program.version('1.0.2')
  .option('-s, --save <filename>', 'save file as <filename>.', outputFilename)
  .option('-d, --debug', 'save debug file')
  .option('-v, --verbose', 'print more details', verbosity, 0)
  .option('-f, --force-download', 'don\'t load cached webpages, always download from remote server')
  .option('-l, --limit <num>', 'limit max simultaneous downloads.', parseInt, 1)
  .option('-w, --wait <millisecond>', 'Wait between each connection.', parseInt, 2000)
  .option('-n, --no-cache', 'don\'t keep downloaded webpages')
  .option('-c, --cache <path>', 'path of cache', 'cache')
  .option('-r, --report <path>', 'path of report', 'report')
  .option('-o, --output-format <txt,...>', 'support tab-separated values (txt), comma-separated values (csv), excel (xlsx) or JSON (json)', list, ['txt'])
  .option('-a, --language <lang>', 'choose language (zh-hk = Traditional Chinese, en = English)', /(zh-hk|en)/, 'en')
  .option('-u, --user-agent <user-agent>', 'set user-agent', /.+/, 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36')
  .parse(process.argv)

//http.globalAgent.maxSockets = program.limit
banner()
//console.log(toCSV([productHeaders[program.language]],","))
if (!fs.existsSync(program.cache)) {
  fs.mkdirSync(program.cache);
}
if (!fs.existsSync(program.report)) {
  fs.mkdirSync(program.report);
}

throttledRequest.configure({
  requests: program.limit,
  milliseconds: 2000, //program.millisecond
});
process.stdout.write('Step 1 of 4: Checking categories...')
let fullUrl = URL.resolve(domain, program.language)
httpdownload(fullUrl, path.join(program.cache, date, 'category', encodeURIComponent(fullUrl)), getCategory, downloadProducts)
//throttledRequest("http://example.org")
function verbosity(v, total) {
  return total + 1
}

function httpdownload(url, filename, callback, finalCallback) {
  fs.exists(filename, function (exists) {
    if (program.forceDownload || !exists || exists && !fs.statSync(filename).size) {
      if (program.verbose)
        console.log('Downloading ' + url + ' as ' + filename + ' after ' + program.wait + ' milliseconds.')
      var p = path.parse(filename)
      mkdirp.sync(p.dir)
      // setTimeout(function () {
      _httpdownload(url, filename, callback, finalCallback)
      // }, program.wait)
    } else {
      if (program.verbose)
        console.log('Loading cached ' + url + ' named ' + filename)
      loaded++
      var data = fs.readFileSync(filename, {
        encoding: 'utf8'
      })

      if (data) {
        callback(data, url, finalCallback)
      }
    }
  })
}

function httpdownloadAsync(url, filename, callback) {
  fs.exists(filename, function (exists) {
    if (program.forceDownload || !exists || exists && !fs.statSync(filename).size) {
      if (program.verbose) console.log('Downloading ' + url + ' as ' + filename)
      var p = path.parse(filename)
      mkdirp.sync(p.dir)
      _httpdownloadAsync(url, filename, callback)
    } else {
      if (program.verbose) console.log('Loading cached ' + url + ' from ' + filename)
      loaded++
      var data = fs.readFileSync(filename, {
        encoding: 'utf8'
      })

      if (data) {

        callback(null, data)
      }
    }
  })
}

function downloadProducts(categories) {
  console.log(categories.length + ' categories found.')
  process.stdout.write('Step 2 of 4: Checking products...')
  async.each(categories, function (url, callback) {
  let fullUrl=URL.resolve(domain,url)
    fullUrl= updateQueryString(fullUrl, {
      resultsForPage: 100
    })
    
    httpdownload(fullUrl, path.join(program.cache, date, 'products', encodeURIComponent(fullUrl)), getProducts, callback)
  }, function (err) {
    console.log(Object.keys(products).length + ' products found.')
    downloadProductsDetails()
  })
}

function saveFile(basename, formats, data) {
  var buff
  var names = []
  formats.forEach(function (format) {
    var name = basename + '.' + format
    switch (format) {
      case 'txt':
        fs.writeFileSync(name, toCSV(data, '\t'))
        names.push(name)
        break
      case 'csv':
        fs.writeFileSync(name, toCSV(data, ','))
        names.push(name)
        break
      case 'json':
        fs.writeFileSync(name, JSON.stringify(data))
        names.push(name)
        break
      case 'xlsx':
        const excel = require('msexcel-builder')
        var workbook = excel.createWorkbook(process.cwd(), name)
        var keys = Object.keys(data)
        var rows = keys.length
        var cols = 0
        keys.forEach(function (key) {
          if (cols < data[key].length) cols = data[key].length
        })


        var sheet1 = workbook.createSheet(date, cols, rows)
        keys.forEach(function (key, i) {
          for (var j = 0; j < data[key].length; j++)
            if (data[key][j]) sheet1.set(j + 1, i + 1, data[key][j])
        })
        workbook.saveSync();
        names.push(name)
        break
    }
  })
  return names
}

function downloadProductsDetails() {

  var basename = date + '_products_only'
  var filenames = saveFile(path.join(program.report, basename), program.outputFormat, products)
  //console.log([productHeaders[program.language]].concat(products))
  //var filenames = saveFile(path.join(program.report, basename), program.outputFormat, [productHeaders[program.language]].concat(products))
  if (filenames.length) console.log('Basic products information saved to ' + filenames.join(', '))

  loaded = 0
  process.stdout.write('Step 3 of 4: Checking special offer (It may take up to 2 hours, be patient)...')

  async.each(products, function (product, calllback) {
    var url = product[0]
    var id = product[1]
    httpdownload(url, path.join(program.cache, date, 'details', encodeURIComponent(url)), getProductDetail, calllback)
  }, function (err) {
    console.log('done.')
    process.stdout.write('Step 4 of 4: Merging Products with special offers...')
    cleanUp()
    console.log('All done. Total time spent: ' + prettify(new Date().getTime() - time))
  })
}

function getLocalDate(time) {
  var d = time ? new Date(time) : new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() / 60)
}

function cleanUp() {
  process.stdout.write('Saving...')
  var filenames = saveFile(path.join(program.report, date + '_complete'), program.outputFormat, mergeProducts(products, specialOffers, promotions, others))

  console.log('saved to ' + filenames.join(', '))
  if (program.debug) {
    var basename = date + '_special_offers_only'
    saveFile(path.join(program.report, basename), program.outputFormat, specialOffers)
    var basename = date + '_promotions_only'
    saveFile(path.join(program.report, basename), program.outputFormat, promotions)
    var basename = date + '_stocks_only'
    saveFile(path.join(program.report, basename), program.outputFormat, others)
  } else {
    var basename = path.join(program.report, date + '_products_only')
    process.stdout.write('Removing...')
    var filenames = program.outputFormat.map(function (ext) {
      var filename = basename + '.' + ext
      try {
        if (fs.accessSync(filename, fs.F_OK)) fs.unlinkSync(filename)
      } catch (e) {}
      return filename
    })
    console.log(filenames.join(', ') + ' done.')
    var timeElapsed = new Date().getTime() - time
    console.log('Total time spent: ' + prettify(time))
  }
}

function updateQueryString(url, newQuery) {
  var url2
  if (typeof url == 'string') {
    url2 = URL.parse(url, true)
  }
  for (var i in newQuery) {
    url2.query[i] = newQuery[i]
  }
  url2.search = '?' + querystring.stringify(url2.query)
  url2.path = url2.pathname + url2.search
  return typeof url == 'string' ? url2.format(url2) : url2
}

function _httpdownloadAsync(url, filename, callback) {
  var res = function (response) {
    var str = ''
    response.on('data', function (chunk) {
      str += chunk
    })
    response.on('error', function (e) {
      console.log(e)
      callback(null, str)
    })
    response.on('end', function () {
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
  if (typeof url == 'string') url2 = URL.parse(url, true)
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
        'User-Agent': program.userAgent,
        //'Cookie': 'lang=' + program.language
      }
    }, params), res)
    req.on('error', function (e) {
      console.log(e)
      callback(e)
    }).end()
  } catch (e) {
    console.error('Error when downloading ' + url)
    console.error(e)
    callback(e)
  }
}

function _httpdownload(url, filename, callback, finalCallback) {
  throttledRequest(url, function (error, response, body) {
    if (error) {
      console.error(error)
      callback('', url, finalCallback)
    } else {
      if (program.cache)
        fs.writeFileSync(filename, body)
      callback(body, url, finalCallback)
    }
  })
}

function _httpdownload_old(url, filename, callback, finalCallback) {

  var res = function (response) {
    var str = ''
    response.on('data', function (chunk) {
      console.log(chunk)
      str += chunk
    })
    response.on('error', function (e) {
      console.log(e)
      callback(str, url, finalCallback)
    })
    response.on('end', function () {
      try {
        if (program.cache) fs.writeFileSync(filename, str)
      } catch (e) {
        console.error(e)
      }
      callback(str, url, finalCallback)
    })
  }
  var url2
  var params = {}
  if (typeof url == 'string') url2 = URL.parse(url, true)
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
        'User-Agent': program.userAgent,
        'Cookie': 'lang=' + program.language
      }
    }, params), res)
    req.on('error', function (e) {
      console.log(e)
      callback('', url, finalCallback)
    }).end()
  } catch (e) {
    console.error('Error when downloading ' + url)
    console.error(e)
    finalCallback()
  }
}
var time = 0
var processed = 0

function getProductDetail(body, url, callback) {
  if (time == 0) time = new Date().getTime()
  if(body.indexOf("Access Denied") > -1)
  {
    console.error("Server overloaded when downloading "+ url)
    process.exit(1)
  }
  var $ = cheerio.load(body)
  var id = $('input[name=productCodePost]').attr('value')

  let specialOffer = []
  $('div.offer-table > div').each(function () {
    specialOffer.push([
      $(this).attr('data-value'),
      $('span.offAmount', this).text().replace('HK$', '').trim()
    ])
  })

  if (specialOffer.length > 1) specialOffers[id] = specialOffer

  let promotion = []
  $("div.TabPage-Special-Offers div.box").each(function () {
    specialOffer.push([
      $(this).find("div.title span").text(),
      $(this).find("div.info").text(),
      $(this).find("a").attr("href")
    ])
  })

  if (promotion.length > 1) promotions[id] = promotion

  // …
  processed++

  if (processed % 50 == 0) {

    if (loaded < processed) {
      var timeElapsed = new Date().getTime() - time
      var timeleft = timeElapsed / (processed - loaded) * (Object.keys(products).length - processed)
      process.stdout.clearLine()

      process.stdout.cursorTo(0)
      process.stdout.write(Object.keys(products).length - processed + ' products left, elapsed time: ' + prettify(timeElapsed) + ', estimated remaining time: ' + prettify(timeleft) + '/ ' + timeleft.toFixed() + ' seconds.')
    }
  }

  if (typeof callback == 'function') callback(null, specialOffer, promotion, [])
  return [
    specialOffer, promotion, []
  ]
}

function prettify(time, fmt) {
  fmt = fmt || '%Y years %m months %d days %h hours %i minutes %s seconds'
  var date = new Date(time)
  var str = []
  var Y = date.getUTCFullYear() - 1970
  var m = date.getUTCMonth()
  if (fmt.indexOf('%Y') == -1) m += Y * 12
  var d = date.getUTCDate() - 1
  var h = date.getUTCHours()
  if (fmt.indexOf('%d') == -1) h += d * 24
  var i = date.getUTCMinutes(),
    s = date.getUTCSeconds()
  if (Y) str.push(Y + ' years')
  if (m || str.length) str.push(m + ' months')
  if (d || str.length) str.push(d + ' days')
  if (h || str.length) str.push(h + ' hours')
  if (i || str.length) str.push(i + ' minutes')
  if (s || str.length) str.push(s + ' seconds')
  return str.join(' ')
}

function mergeProducts(products, specialOffers, promotions, others) {

  var mergedProducts = Object.assign(products)
  var count = 0
  var count2 = 0
  for (let i in specialOffers)
    count = count < specialOffers[i].length ? specialOffers[i].length - 1 : count
  count = count / 2 * 3
  for (let i in promotions)
    count2 = count2 < promotions[i].length ? promotions[i].length - 1 : count2
  finalHeaders = productHeaders[program.language]
  for (let i = 0; i < count / 3; i++)
    finalHeaders = finalHeaders.concat(specialOfferHeaders[program.language])
  finalHeaders = finalHeaders.concat(othersHeaders[program.language])
  for (let i = 0; i < count2; i++)
    finalHeaders = finalHeaders.concat(promotionHeaders[program.language])

  Object.keys(mergedProducts).forEach(function (id) {

    var match = false
    var minPrice = mergedProducts[id][9]

    if (others[id])

    {
      mergedProducts[id] = mergedProducts[id].concat(others[id].slice(1))
    }

    if (specialOffers[id])

    {
      var tmp = specialOffers[id].slice(1)
      while (tmp.length) {
        var tmp2 = tmp.slice(0, 2)
        var specialOfferPrice = Number(mergedProducts[id][9]) - Number(tmp[1]) / Number(tmp[0])
        tmp2.push(specialOfferPrice)

        if (specialOfferPrice < minPrice) minPrice = specialOfferPrice
        mergedProducts[id] = mergedProducts[id].concat(tmp2)
        tmp = tmp.slice(2)
      }
      for (let k = 0; k < count - (specialOffers[id].length - 1) / 2 * 3; k++)
        mergedProducts[id].push('\'-')
      match = true
    }
    if (!match)
      for (let k = 0; k < count; k++)
        mergedProducts[id].push('\'-')
    mergedProducts[id].push(minPrice)
    mergedProducts[id].push((1 - minPrice / mergedProducts[id][9]) * 100 + '%')

    var size = 1

    var parsedSize = mergedProducts[id][7].replace('BOX', '').replace(/[^0-9xX\.]/g, '').replace(/[xX]/g, '*')

    if (parsedSize.match(/^[\d\*]+$/g)) try {
      size = eval(parsedSize)
    } catch (e) {
      console.error(mergedProducts[id][7], parsedSize)
    }
    mergedProducts[id].push(minPrice / size)

    match = false

    if (promotions[id])

    {
      var tmp = promotions[id].slice(1)
      mergedProducts[id] = mergedProducts[id].concat(tmp)
      for (let k = 0; k < count2 - tmp.length; k++)
        mergedProducts[id].push('\'-')
      match = true
    }
    if (!match)
      for (let k = 0; k < count2; k++)
        mergedProducts[id].push('\'-')
  })


  var newProducts = []
  newProducts.push(finalHeaders)
  for (let i in mergedProducts)
    newProducts.push(mergedProducts[i])


  return newProducts
}

function getProducts(body, url, callback) {

  var $ = cheerio.load(body),
    product = []
  var brands = $('div.brandFilterStyle input[data-facet_query]').map(function () {
    return $(this).attr("data-facet_query").substr(17)
  }).get()
  if (program.debug)
    fs.writeFileSync("brands.txt", brands.join("\n"))
  let category=$("span.lastElement").text()
  $('div.product-container div.item').each(function (i, el) {
	let fullUrl=$(el).find('a').eq(0).attr('href').trim()
	//if(fullUrl.indexOf("/" + program.language+ "/") == -1)
	//{
	//	if(program.verbose > 3)
	//	console.log("Skipping url with wrong language: " + fullUrl )
	//	return
	//	}
    var uri = fullUrl.split('/')
    var id = uri[uri.length - 1].match('\\d+$')[0]
    //'en': 'url\tid\timage path\tBrand\tBrand\tName\tName\tSize\tRecommended Retail Price\tSelling Price\tSpecial Offer\tNo Stock?\tQuantity you can buy'.split('\t')
    let productName=$(el).find('div.photo img').eq(0).attr('alt').replace(/-BP_\d+$/, '')
    product = [
      URL.resolve(domain , fullUrl),
      id,
      $(el).find('div.photo img').eq(0).attr('data-original'),
      category,
      $(el).find('div.name a').eq(0).text().trim().replace(productName, ""),
      //uri[1].substr(8),
      uri[2],
      productName,
      $(el).find('span.sizeUnit').eq(0).text().trim(),
      $(el).find('div.display-price div.rrp span').eq(0).text().replace('HK$', '').replace(',', '').trim(),
      $(el).find('div.display-price div.discount').eq(0).text().replace('HK$', '').replace(',', '').trim(),
      $(el).find('div.special-offer').eq(0).text().trim(),
      // $(el).find('dl.SpecialPro').map(function () {
      //   return $(this).text().trim()
      // }).filter(function () {
      //   return this.trim().length
      // }).get().join(', ')
      //$(el).find("span[data-arrivalsoon]").length,
      $(el).find("input.maxOrderQuantity").attr("value")
    ]
    //$(el).find('div.special-offer').eq(0).text().trim(),
    let bulkDiscount = product[10].match(/([\d.]+) \/ ([\d.]+)/)
    if (bulkDiscount) {
      bulkDiscount = eval(bulkDiscount[0])
      product.push(bulkDiscount)
    } else
      product.push(product[9])
    if (program.verbose > 3)
      console.log(product)
   products[id]=product
  })

  let hasNextUrl = $('div.btn-show-more').eq(0).attr('data-hasnextpage')
  if (hasNextUrl == "true") {
    let nextUrl = $('div.btn-show-more').eq(0).attr('data-nextpageurl')
    if (program.verbose > 2)
      console.log("Found next url: " + nextUrl)
    if (nextUrl != 'javascript:void(0);' && nextUrl.indexOf("/lc/") != -1) {
    let fullUrl 
		if(nextUrl.indexOf('/en/') == 0)
			if(program.language != 'en')
			fullUrl = URL.resolve(domain, "/" + program.language + nextUrl.substr(3))
			else
			fullUrl = URL.resolve(domain, nextUrl)
		else if(nextUrl.indexOf('/zh-hk/') == 0)
			if(program.language != 'zh-hk')
			fullUrl = URL.resolve(domain, "/" + program.language + nextUrl.substr(6))
			else
			fullUrl = URL.resolve(domain, nextUrl)
		else
			fullUrl = URL.resolve(domain, program.language + nextUrl)
      	//if (fullUrl.indexOf(program.language) == -1)
		//fullUrl = URL.resolve(domain, program.language + nextUrl)
      
      httpdownload(fullUrl, path.join(program.cache, date, 'products', encodeURIComponent(fullUrl)), getProducts, callback)
    } else {
      callback()
    }
  } else {
    callback()
  }
}

function getCategory(data, url, callback) {
  var $ = cheerio.load(data)

  var categories = $('div.category a[href]').map(function () {
    return this.attribs.href
  }).get().filter(function (v) {
    return v.indexOf("/lc/") != -1
  })
  if (program.debug) {
    //console.log(categories)
    fs.writeFileSync("categories.txt", categories.join("\n"))
  }
  callback(categories)
}

function banner() {
  console.log('ParkNShop.com price dumping script')
}

function list(val) {
  var values = val.split(',')
  return values.filter(function (value) {
    return /(txt|csv|json|xlsx)/.test(value)
  })
}