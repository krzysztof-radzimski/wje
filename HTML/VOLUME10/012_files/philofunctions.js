function footnotes(contID,noteID)
{
	var noteholder = document.getElementById(noteID);
	var spans = $$('#'+contID+' span.fnote');
	var notes = 0;
	
	for (i=0;i<spans.length;i++)
	{
			notes++;
			noteholder.innerHTML += "<div class='fnote'><a name='note"+notes+"'></a><strong>" + spans[i].id + ".</strong> " + spans[i].innerHTML + " <a href='#nlink"+notes+"' title='return to text'>&#8617;</a></div>";
			spans[i].innerHTML = "<a name='nlink"+notes+"' href='#note" + notes + "' title='view footnote' class='fnote'>" + spans[i].id + "</a>";
	}
	
	
}
function getPrimarySources()
{
//if($('text').getElement('center').get('text') == " -- 278 -- " && $('content').getElement('a').name =="jec-wjeo02") {
//$$('#footnotes .fnote')[0].getElement('p').set('html', 'Calvin, in his <span style="font-style: italic;">Institutes of the Christian Religion,</span> Bk. I, ch. 9, no. 1<a href="/editorscripts/Calvin EEBO.html" title="View Primary Source (new window)" target="_blank" id="primary">&#8618;</a>, says: "It is not the office of the Spirit that is promised us, to make new and before unheard of revelations, or to coin some new kind of doctrine, which tends to draw us away from the received doctrine of the gospel; but to seal and confirm to us that very doctrine which is by the gospel." And in the same place he speaks of some, that in those days maintained the contrary notion, pretending to be immediately led by the Spirit, as persons that were governed by a most haughty self-conceit; and not so properly to be looked upon as only laboring under a mistake, as driven by a sort of raving madness. [See above, pp. 64-5.]');
//}
//	if($('text').getElement('center').get('text') == " -- 180 -- ") {
//var anchor = new Element('a', {
  //  			'href': 'http://solomon.tcpt.alexanderstreet.com/cgi-bin/asp/philo/cpt/getobject.pl?p.1219:394.cpt',
//'target': '_blank',
//'html': '&#8618;',
//'title': "View Primary Source (new window)"
        
//			});
	//		$$('#footnotes .fnote')[2].getElement('span').appendChild(anchor);

//}
/*
if($$(".head").length > 1){
if($$(".head")[0].get("text") =="The Way of Holiness") {
var p = new Element('p');
var anchor = new Element('a', {
    			'href': '#',
'text': 'View related articles',
'events': {
        'click': function(e){
            e.preventDefault();
            $('articles').setStyle('display', 'block');
            $('articles').fade('show');
        } }
			});
p.appendChild(anchor);
$('block-block-4').appendChild(p);
var ul = new Element('ul', {
    			'id': 'articles'
        
			});
			var li = new Element('li', {
    			'html': '<a href="/articles/wolterstorff,%20nicholas.pdf" target="_blank">Liturgy, Justice, and Holiness - Nicholas Wolterstorff</a>'
        
			});
ul.appendChild(li);
$('block-block-4').appendChild(ul);
$('articles').fade('hide');
$('articles').setStyle('display', 'none');
}
}
*/
}
	
	
function getScriptureTips() {
var refs = [];
 $$('span.reg').each(function(item, index) {
item.set('id',  escape(item.get('text')));
refs.push(item.get('text'));
});
var jsonRequest = new Request.JSON({url: "/editorscripts/getVerses.php", onComplete: function(response){
if(response) {
	if(response.status == "OK") {
$each(response.refs, function(item, index) {
$(escape(index)).set('title', item.title);
$(escape(index)).store('tip:title', item.title);
$(escape(index)).store('tip:text', item.text);
$(escape(index)).set('class', 'scripture');
});
var ScriptureTip = new Tips($$('.scripture'), {
   className: "tool-tip",
	initialize:function(){
					this.tip.fade.bind(this.tip, [0]);
				},
				onShow: function(toolTip) {
					this.tip.fade(1);
				},
				onHide: function(toolTip) {
					this.tip.fade(0);
				}
			
			});
}}}}).post({'refs': JSON.encode(refs)});
}
function getCloudData() {
var text = JSON.encode($('text').innerHTML);
var frequencies = [];
var jsonRequest = new Request.JSON({url: "/editorscripts/tagCloud.php", onComplete: function(response){
  if(response.frequencies.length < 2) return;
  var cloudEl = new Element('ol', {
  'class': 'cloud',
  'id': 'doc_cloud'
  			});
  var cloudAnchor = new Element('a', {
  'href': '#',
  'html': 'View word cloud',
  'id': 'cloudLink'
  			});
  $('cloud-anchor').appendChild(cloudAnchor);
  $('cloud-anchor').appendChild(cloudEl);


      var cloud = new TagCloud( 'doc_cloud', {
  tag_class: "tag", // By default a class of "tag" is set on all tags, change it here
  hidden_class: "hidden", // By default a class of "hidden" is applied to hidden tags
  tag_sizes: [ '8', '11' ,'14' ],
    clouds: {
      words: response
      
    }
  });
	  cloud.draw( 'words' );
	  $('doc_cloud').setStyle('display', 'none');
	  $('doc_cloud').fade('hide');
  $('cloudLink').addEvent("click", function(e) {e.preventDefault();   $('doc_cloud').setStyle('display', 'block');
	  $('doc_cloud').fade('toggle'); });
}}).post({'text': text});
}

window.addEvent('domready', function(){
$('tabs-wrapper').style.borderBottom = 'none';
if ($$(".navbiblio a").length > 0 && $$(".navbiblio a")[0].name.match(/jec-/) && $$('.navhead').length > 0 && $$('.navhead')[0].get('html') == "Search in Selected Parts") {
if($$('#content b') .length > 1) {doc = $$('#content b')[1].get('html');
var form = new Element('form', {
	'action' : '/cgi-bin/editor/getPB.cgi',
	'style' : 'margin-bottom: 3px;',
    'html' : "<input type='hidden' value='"+doc+"' name='file' />Go to page: <input name='page'  style='width: 2.5em;' /> <input type='submit' value='Jump'/>"
			});
			$$('#content form')[0].parentNode.insertBefore(form, $$('#content form')[0]);
} }
var timedFootnotes = footnotes.create({ //When called, this function will attempt.
	arguments: ['text', 'footnotes'],
    attempt: true,
    delay: 5
});
timedFootnotes();
if($('text')) {
var timedCloud = getCloudData.create({ //When called, this function will attempt.
    attempt: true,
    delay: 1000
});
timedCloud();
}
var timedPrimarySources = getPrimarySources.create({ //When called, this function will attempt.
    attempt: true,
    delay: 10
});
timedPrimarySources();
if($("content").getElementsByTagName("a")[0].name && $("content").getElementsByTagName("a")[0].name == "natick") {
	var myDiv1 = new Element('div', {
	    			'class': 'head',
	    			'html': '',
	    			'styles': {
	        			'display': 'none'
	    			}
				});
				
				var myDiv2 = new Element('div', {
								
				    			'class': 'head',
				    			'html': '',
				    			'styles': {
				        			'display': 'none'
				    			}
							});
				
$("text").appendChild(myDiv1);	
$("text").appendChild(myDiv2);
}
if($$('.head')) {
if((($$('.head')[1] && ($$('.head')[1].parentNode == $$('.head')[0].parentNode)))) {
var getImages = function() {}
el = $$('.head')[1];
id = el.innerHTML;
el.setStyle('display', 'none');

if($("content").getElementsByTagName("a")[0].name && $("content").getElementsByTagName("a")[0].name == "natick") {
id = "natick";
}
/*if($$(".head")[0].get("text") =="The Way of Holiness") {
el.setStyle('display', 'block');
id = "11.Is. 35'8(trans)";
}*/
var myDiv = new Element('div', {
    			'id': 'transcriptImagesHolder',
    			'html': '',
    			'styles': {
        			'display': 'none',
        			'border': '1px solid black',
        			'right': '180px',
                    'position': 'absolute'
    			}
			});
var myDivL = new Element('div', {
    			'id': 'transcriptImagesHolderL',
    			'html': '',
    			'styles': {
        			'display': 'none',
        			'border': '1px solid black',
        			'left': '180px',
                    'position': 'absolute'
    			}
			});

/*if($$(".head")[0].get("text") =="The Way of Holiness") {
myDiv.setStyle('right', '0px');
myDivL.setStyle('left', '0px');
}	*/		

var divHolder = el.parentNode.insertBefore(myDiv, el.parentNode.getElement("p"));
var divHolderL = el.parentNode.insertBefore(myDivL, el.parentNode.getElement("p"));

var jsonRequest = new Request.JSON({url: "/editorscripts/getDocImage.php", onComplete: function(doc){
   if(doc.status == "OK") {
   		var p = new Element('p');
var anchor = new Element('a', {
    			'href': '#',
'text': 'View other editions',
'events': {
        'click': function(e){
            e.preventDefault();
            $('transcriptImagesHolder').setStyle('display', 'block');
            if($$(".head")[0].get("text") =="The Way of Holiness") {
            $('transcriptImagesHolderL').setStyle('display', 'block');
			$('right').setStyle('width', '350px');
			$('left').setStyle('width', '250px');
			$('center').setStyle('margin-right', '350px');
			$('center').setStyle('margin-left', '250px');
			}
            getImages();
        } }
			});
p.appendChild(anchor);
var myDiv = new Element('div', {
    			'class': 'transcriptImageHolder',
    			'styles': {
        			'display': 'block',
        			'right': '0',
                    'overflow': 'auto',
        			'width': '250px',
                    'position': 'relative'
    			}
			});
var myImg = new Element('img', {
    			'class': 'transcriptImage',
    			'src': ''
			});
		myDiv.appendChild(myImg);
	    divHolderL.appendChild(myDiv);
$('block-block-4').appendChild(p);
        getImages = function() {
        	$each(doc.images,function(image, index){
        	var myDiv = new Element('div', {
    			'class': 'transcriptImageHolder',
    			'styles': {
        			'display': 'block',
        			'right': '0',
                    'overflow': 'auto',
        			'width': '350px',
                    'position': 'relative'
    			}
			});
		var myImg = new Element('img', {
    			'class': 'transcriptImage',
    			'src': '/doc_images/'+image
			});
		myDiv.appendChild(myImg);
	    divHolder.appendChild(myDiv);	
        });
    }
    }
}}).POST({'docID': id});
}
}
var timedScripture = getScriptureTips.create({ //When called, this function will attempt.
    attempt: true,
    delay: 10
});
timedScripture();
});