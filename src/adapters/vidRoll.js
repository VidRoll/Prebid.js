import Adapter from 'src/adapters/adapter';
import bidfactory from 'src/bidfactory';
import bidmanager from 'src/bidmanager';
import * as utils from 'src/utils';
import { ajax } from 'src/ajax';
import { STATUS } from 'src/constants';

//const ENDPOINT = '//hollywoodwire.tv/rtbBidder.php';
const ENDPOINT = 'https://vidroll-rtb-server-staging-2.azurewebsites.net/rtb';

/**
 * Bidder adapter for /ut endpoint. Given the list of all ad unit tag IDs,
 * sends out a bid request. When a bid response is back, registers the bid
 * to Prebid.js. This adapter supports alias bidding.
 */
function VidRollAdapter() {

  let baseAdapter = Adapter.createNew('vidRoll');
  let bidRequests = {};
  let usersync = false;

  let  openrtbBidRequest = {
    "at": 2,          // auction type
    "tmax": 120,      // timeout max
    "imp": [],
    "site": {
      "name": window.top.document.title,     // Site name
      "domain": utils.getTopWindowLocation().hostname,
      "page": utils.getTopWindowUrl(),
      "ref": document.referrer,
    },
    "device": {
      "ip": "",
      "ua": window.navigator.userAgent,
      "os": "",
      "dnt": 0          // 1 - do not track
    }
  };

  function createImpObj(id, w, h, bidfloor) {
    var obj = {};

    obj.id = id;
    obj.bidfloor = bidfloor;
    obj.video = {
      w,
      h,
      "pos": 1,
      "api": [1, 2],
      "protocols": [2, 3],
      "mimes": [
        "video/mp4"
      ],
      "linearity": 1
    }
    return obj;
  }

  /* Prebid executes this function when the page asks to send out bid requests */
  baseAdapter.callBids = function(bidRequest) {
    const bids = bidRequest.bids || [];
    var member = 0;
    let userObj;
    console.log(`callBids`, bids);
    const imps = bids
      .filter(bid => valid(bid))
      .map(bid => {
        // map request id to bid object to retrieve adUnit code in callback
        bidRequests[bid.bidId] = bid;

        openrtbBidRequest.id = bid.bidId;

        const params = bid.params;
        const dim = bid.sizes;

        openrtbBidRequest.site.id = params.partnerId;

        let imp = createImpObj(parseInt(params.placementId), dim[0], dim[1], params.bidFloor || 0);

        return imp;
      });

    if (!utils.isEmpty(imps)) {
      openrtbBidRequest.imp = imps;
      console.log(openrtbBidRequest)
      const payloadJson = openrtbBidRequest;
      if (member > 0) {
        payloadJson.member_id = member;
      }
      const payload = JSON.stringify(payloadJson);
      console.log(`payload`, payload);
      ajax(ENDPOINT, handleResponse, payload, {
        contentType: 'application/json',
        // TODO update to true
        withCredentials : false
      });
    }
  };

  /* Notify Prebid of bid responses so bids can get in the auction */
  function handleResponse(response) {
    let parsed;
    console.log(`handleResponse`, response);
    console.log(`bidRequests`, bidRequests);

    try {
      parsed = JSON.parse(response);
    } catch (error) {
      utils.logError(error);
    }

    if (!parsed || parsed.error) {
      let errorMessage = `in response for ${baseAdapter.getBidderCode()} adapter`;
      if (parsed && parsed.error) {errorMessage += `: ${parsed.error}`;}
      utils.logError(errorMessage);

      // signal this response is complete
      Object.keys(bidRequests)
        .map(bidId => bidRequests[bidId].placementCode)
        .forEach(placementCode => {
          bidmanager.addBidResponse(placementCode, bidfactory.createBid(STATUS.NO_BID));
        });
      return;
    }

    utils._each(parsed.seatbid, function(seatbid) {
      utils._each(seatbid.bid, function(seatbidBid) {
        let bid = bidfactory.createBid(STATUS.GOOD);
        let nurl;

        if (seatbidBid.adm) {
          nurl = `http://hollywoodwire.tv/vast.php?vast=` + seatbidBid.adm;
        } else {
          nurl = seatbidBid.nurl;
        }

        bid.code = baseAdapter.getBidderCode();
        bid.bidderCode = baseAdapter.getBidderCode();
        bid.cpm = seatbidBid.price;
        bid.vastUrl = nurl;
        bid.descriptionUrl = nurl;
        bid.creative_id = seatbidBid.crid;
        bid.width = seatbidBid.w;
        bid.height = seatbidBid.h;
        console.log(`addBidResponse`, bidRequests[parsed.id].placementCode, bid);
        bidmanager.addBidResponse(bidRequests[parsed.id].placementCode, bid);
      });
    });
  }

  /* Check that a bid has required paramters */
  function valid(bid) {
    if (bid.params.placementId || bid.params.member && bid.params.invCode) {
      return bid;
    } else {
      utils.logError('bid requires placementId or (member and invCode) params');
    }
  }

  return {
    createNew: VidRollAdapter.createNew,
    callBids: baseAdapter.callBids,
    setBidderCode: baseAdapter.setBidderCode,
  };

}

VidRollAdapter.createNew = function() {
  return new VidRollAdapter();
};

module.exports = VidRollAdapter;
