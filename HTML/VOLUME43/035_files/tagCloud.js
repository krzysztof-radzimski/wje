var TagCloud = new Class({

  initialize: function( cloud, options ) {
    this.options = $merge({
      clouds: {},
      tag_class: 'tag',
      hidden_class: 'hidden',
      tag_sizes: [ '8px', '12px', '18px', '20px', '22px', '24px', '26px', '28px' ]
    }, options);
    this.cloud = $(cloud);
    this.depth = this.options.tag_sizes.length;
    this.tags = $A([]);
    $each(this.options.clouds, function(v, k){
      this.reset_bounds();
            $each(v.frequencies, function(v2, k2){
        this.expand_bounds(v2);
      }.bind( this )); 
      $each(v.frequencies, function(v2, k2){
        this.update_tag( k, k2, v2 );
      }.bind( this )); 
    }.bind( this )); 
    this.sort_tags();
  },

  update_tag: function(cloud, tag_content, frequency){
    var found = this.tags.some(function(tag, i) {
      if (tag.content == tag_content) {
        tag.cloud_weights.set(cloud, this.get_weight(frequency));
        return true;
      }
      return false;
    }.bind( this ));
    if (!found){
      var cloud_weights = new Hash();
      cloud_weights.set(cloud, this.get_weight(frequency));
      tag = { content: tag_content, cloud_weights: cloud_weights };
      tag.toString = function(){ return this.content }
      this.tags.push(tag);
    }
  },

  get_weight: function( frequency ){
    var class_i = Math.floor(
      parseFloat(
        ((frequency-this.lower) / (this.upper-this.lower)),
          this.depth
      ) * this.depth
    );
    if (class_i == this.depth) class_i = class_i - 1;
    return class_i;
  },

  reset_bounds: function(){
    this.lower = 99999999999;
    this.upper = 0;
  },

  expand_bounds: function(v){
    if (v > this.upper) this.upper = v;
    if (v < this.lower) this.lower = v;
  },

  sort_tags: function( cloud_name ){
    this.tags.sort();
  },

  draw: function( cloud_name ) {
    $each(this.tags, function( tag, i ){
      if (!tag.element) {
        tag.element = new Element( 'li', {
          'rel': 'tag',
          'class': this.options.tag_class
        });
        tag.element.set('html', tag.content).injectInside( this.cloud );
        tag.fx = new Fx.Morph( tag.element );
        this.cloud.appendText("\n");  
      }
        
      if ( ''+tag.cloud_weights.get(cloud_name) != 'NaN' &&
           ''+tag.cloud_weights.get(cloud_name) != 'null') {
        if (this.options.hidden_class)
          tag.element.removeClass(this.options.hidden_class);
        tag.fx.start({
          'opacity': 1,
          'font-size': this.options.tag_sizes[tag.cloud_weights.get(cloud_name)]
        });
        return;
      }

      if ( tag.element.getStyle('opacity') != 0 ) {
        tag.fx.start({
          'opacity': 0,
          'font-size': 0
        });
        if (this.options.hidden_class)
          tag.element.addClass(this.options.hidden_class);
        return;
      }
    }.bind( this ));
  }

});