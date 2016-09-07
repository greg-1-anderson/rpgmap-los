// TODO: Separate Phaser.Game app from LOS 'reveal' function & related.

// Forgotten Tombs: 1561, 2157
// Deep grotto: 1561, 2170

var game = new Phaser.Game(1561, 2157 /*800, 600*/, Phaser.AUTO, 'phaser-example', { preload: preload, create: create });

function preload() {
  //game.load.image('dungeon', 'assets/rpg/KingSnurresHall.png');
  //game.load.image('mask', 'assets/rpg/KingSnurresHallMask.png');
  game.load.image('dungeon', 'assets/rpg/ForgottenTombsPlayerMap.png');
  game.load.image('mask', 'assets/rpg/ForgottenTombsMask.png');
  game.load.image('unexplored', 'assets/rpg/unexplored.png');
}

var bmd;
var dungeonBmd;
var mapMask;
var visibleDepthThruWalls = 5;
var sizeOfLightSource = 300;

function create() {
  // TODO: size to source image
	bmd = game.make.bitmapData(1561, 2157);
  mapMask = game.make.bitmapData(bmd.width, bmd.height);
  mapMask.draw('mask');
  mapMask.update();
  dungeonBmd = game.make.bitmapData(bmd.width, bmd.height);
  dungeonBmd.draw('dungeon');
  dungeonBmd.update();

  var revealLocation = new Phaser.Point(270, 85);

	revealMap(revealLocation, sizeOfLightSource, visibleDepthThruWalls);

	bmd.addToWorld();

	game.input.addMoveCallback(refocusReveledSection, this);
}

function refocusReveledSection (pointer, x, y) {
  if (pointer.isDown) {
    var revealLocation = new Phaser.Point(x, y);
    revealMap(revealLocation, sizeOfLightSource, visibleDepthThruWalls);
  }
}

/**
 * Reveal the portion of the map that is visible within LOS
 * of the specified location.
 *
 * @param fromLocation The location on the map to draw from
 * @param lightSourceRadius The radius of the light source illuminating the area
 * @param depth The maximum visible depth into walls (to provide context, so
 *   that a few pixels of the object that is blocking LOS can be seen)
 */
function revealMap(fromLocation, lightSourceRadius, depth) {
	bmd.clear();

  // This does not work -- it messes up the bmd.alphamask() operation below.
  // fillRect is creating a polygon not reset by createLightSourceLosMask()?
  // In any event, a background pattern would not look good with the fade-to-black
  // design of the LOS region.
  // fillWithPattern(bmd.context, game.cache.getImage('unexplored'))

	// The mask returned will have white-and-gray pixels in the shape of the
  // LOS area. When used as an alpha mask, the resulting portion of the
  // map that is rendered will be a fully-lit area shaped like the LOS mask.
  var losAreaMask = createLightSourceLosMask(mapMask, fromLocation, lightSourceRadius, depth);
	bmd.alphaMask(dungeonBmd, losAreaMask);
  // We draw the LOS area over the same bitmap image again; this will darken
  // the image in the places where there are gray or black pixels in the
  // light source mask.
  bmd.draw(losAreaMask, 0, 0, bmd.width, bmd.height, 'multiply');
	bmd.update();
}

// TODO: not needed, maybe just remove
function fillWithPattern(context, img) {
  var img = game.cache.getImage('unexplored');
  var unexploredPattern = context.createPattern(img, 'repeat'); // Create a pattern with this image, and set it to "repeat".
  var saveStyle = context.fillStyle;
  context.fillStyle = unexploredPattern;
  context.fillRect(0, 0, bmd.width, bmd.height); // context.fillRect(x, y, width, height);
  context.fillStyle = saveStyle;
}

/**
 * Create a Light Source / LOS Mask
 *
 * @param mapMask The bitmap data that defines what is visible (transparent
 *   pixels) and what is not (opaque pixels)
 * @param fromLocation The location on the map to scan from
 * @param lightSourceRadius The radius of the light source illuminating the area
 * @param depth The maximum visible depth into walls (to provide context, so
 *   that a few pixels of the object that is blocking LOS can be seen)
 */
function createLightSourceLosMask(mapMask, fromLocation, lightSourceRadius, depth) {
  var losAreaMask = game.make.bitmapData(mapMask.width, mapMask.height);
  var points = calculateLosArea(mapMask, fromLocation);
  createPolygonPath(losAreaMask.context, points);
  losAreaMask.context.lineWidth = depth * 2;
  losAreaMask.context.stroke();
  losAreaMask.context.fill();
  lightSources = game.make.bitmapData(mapMask.width, mapMask.height);
  fillWithLightGradient(lightSources.context, fromLocation, lightSourceRadius);
  losAreaMask.alphaMask(lightSources, losAreaMask);
  return losAreaMask;
}

/**
 * Create a set of points defining an LOS area
 *
 * @param mapMask The bitmap data that defines what is visible (transparent
 *   pixels) and what is not (opaque pixels)
 * @param fromLocation The location on the map to scan from
 */
function calculateLosArea(mapMask, fromLocation) {
  var points = new Array();

  // Seed our initial list of points by scaning in the ordinal directions
  //
  //           o
  //           |
  //           |
  //           |
  //       o---*--o
  //           |
  //           o
  //
  // In the diagram above, "*" represents the location we are scanning from;
  // each of the ordinal directions are scanned until a point touching an
  // opaque pixel (represented by "o") is found on the map.
  points.push(scanLosSegment(mapMask, fromLocation, new Phaser.Point(1, 0)));
  points.push(scanLosSegment(mapMask, fromLocation, new Phaser.Point(0, 1)));
  points.push(scanLosSegment(mapMask, fromLocation, new Phaser.Point(-1, 0)));
  points.push(scanLosSegment(mapMask, fromLocation, new Phaser.Point(0, -1)));

  // Subdivide the list of points if any are too far apart.
  // Repeat until no new points are added.
  //
  //       o   o
  //        \ /|
  //         X |
  //        / \|
  //       o---*--o
  //           |
  //           o
  //
  // For each of the points found, the area between them is subdivided, and
  // the point "X" on the midpoint of the line connecting the two points
  // is found.  The line that passes through this point is then scanned
  // until the next opaque pixel, "o" is found.  If the new point is
  // sufficiently far away from the two points on either side of it, then
  // it is added to the result set, and the process is repeated until a
  // sufficient number of points are found.
  //
  // TODO: re-evaluating all of the points in the set on every iteration
  // is not the most efficient algorithm. This can lead to unnecessary
  // duplicate scanning of some already-finished areas while filling in
  // farther-away areas that require more passes. A better choice would
  // be a recursive algorithm that successively divided the space between
  // each pair of  points, and then inserted the results into the list
  // of points.
  var lastPoints = new Array();
  var max = 100;
  while ((lastPoints.length < points.length) && (max > 0)) {
    lastPoints = points;
    points = addLosSegments(mapMask, fromLocation, points);
    --max;
  }
  return points;
}

/**
 * Scan along a line segment until an opaque pixel is discovered.
 *
 * @param mapMask The bitmap data that defines what is visible (transparent
 *   pixels) and what is not (opaque pixels)
 * @param fromLocation The location on the map to scan from.
 * @param delta The direction to scan in
 */
function scanLosSegment(mapMask, fromLocation, delta) {
    var atLocation = new Phaser.Point(fromLocation.x, fromLocation.y);
    var pixel = Phaser.Color.createColor();

    Phaser.Color.unpackPixel(mapMask.getPixel32(Math.round(atLocation.x), Math.round(atLocation.y)), pixel);

    var max = 1000;
    while ((pixel.a === 0) && inside(mapMask, atLocation) && (max > 0)) {
        atLocation = atLocation.add(delta.x, delta.y);
        Phaser.Color.unpackPixel(mapMask.getPixel32(Math.round(atLocation.x), Math.round(atLocation.y)), pixel);
        --max;
    }

    return atLocation;
}

/**
 * Add more LOS points to the provided set of points if there are any
 * new locations found that are sufficiently far away from the existing points.
 */
function addLosSegments(mapMask, fromLocation, points) {
  var lastPoint = points[0];
  points.push(lastPoint);

  var result = new Array();
  for (i = 1; i < points.length; ++i) {
    var examiningPoint = points[i];
    result.push(lastPoint);

    if (!fairlyClose(examiningPoint, lastPoint)) {
      var newDeltas = findNewDeltas(examiningPoint, lastPoint, fromLocation);
      var newPoint = scanLosSegment(mapMask, fromLocation, newDeltas);
      if (!fairlyClose(newPoint, examiningPoint, 1) && !fairlyClose(newPoint, lastPoint, 1)) {
        result.push(newPoint);
      }
    }

    lastPoint = examiningPoint;
  }

  return result;
}

/**
 * Find a delta value that goes from the provided starting location
 * and passes through the midpoint of the two other points provided.
 * The result is scaled such that the magnitude of EITHER the X or Y
 * component is always exactly 1.0.  This is similar to normalization,
 * save for the fact that it is not the vector magnitude that is scaled.
 * Scaling the delta like this ensures that we will advance exactly one
 * pixel along one of the axises every time through the scan loop.
 */
function findNewDeltas(point, lastPoint, fromLocation) {
  var midpointX = (point.x + lastPoint.x) / 2;
  var midpointY = (point.y + lastPoint.y) / 2;

  var dX = midpointX - fromLocation.x;
  var dY = midpointY - fromLocation.y;

  if (Math.abs(dX) > Math.abs(dY)) {
    dY = dY / Math.abs(dX);
    dX = Math.sign(dX);
  }
  else {
    dX = dX / Math.abs(dY);
    dY = Math.sign(dY);
  }

  var result = new Phaser.Point(dX, dY);
  return result;
}

/**
 * Return 'true' if the specified point lies within the provided bitmap data object.
 */
function inside(bmd, location) {
  var result =
    (location.x > 0) &&
    (location.y > 0) &&
    (location.x < bmd.width) &&
    (location.y < bmd.height);

  return result;
}

function fairlyClose(point, lastPoint, limit = 2) {
  return (Math.abs(point.x - lastPoint.x) <= limit) && (Math.abs(point.y - lastPoint.y) <= limit);
}

/**
 * Given a set of points, use 'moveTo' and 'lineTo' to create a polygon.
 */
function createPolygonPath(context, points) {
  // Make a polygon out of the visible LOS shape
  context.beginPath();
  context.moveTo(points[0].x,points[0].y);
  for (i = 1; i < points.length; ++i) {
    context.lineTo(points[i].x,points[i].y);
  }
  context.closePath();
}

/**
 * Fill with Light Gradient
 *
 * This function fills the provided canvas context with a circular light
 * source of the specified radius.  The resulting image will be drawn in
 * white, with alpha transparency falling off to zero at the edge of the
 * light source.
 */
function fillWithLightGradient(context, fromLocation, lightSourceRadius) {
  context.rect(0,0,1561, 2157);
  // Greate radial gradient with radius equal to the light source.
  // Fill the LOS polygon with the light source gradient.
  var lightSourceGradient = context.createRadialGradient(fromLocation.x, fromLocation.y, 10, fromLocation.x, fromLocation.y, lightSourceRadius);
  lightSourceGradient.addColorStop(0, 'rgba(255,255,255,1)');
  lightSourceGradient.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  lightSourceGradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = lightSourceGradient;
  context.fill();
}

