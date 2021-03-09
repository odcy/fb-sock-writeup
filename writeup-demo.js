console.log('im loaded in!!')

/* tracking current thread id */

const MY_MARK = 'tracked_as_sticker'

let [, curr_thread_id] = window.location.href.match(/\/messages\/t\/(\d+)/) || []

new MutationObserver(e => {
	const relevantLinks = e.map(x => [...x.addedNodes]).flat()
		.map(x => x instanceof Element ? [...x.querySelectorAll('a')] : []).flat()
		.filter(a => a.href.match(/\/messages\/t\/(\d+)/))

	relevantLinks.forEach(a => {
		if (a.hasAttribute(MY_MARK))
			return
		const [, thread_id] = a.href.match(/\/messages\/t\/(\d+)/)
		a.addEventListener('click', _ => {
			console.log(`now switching to ${thread_id}`)
			curr_thread_id = thread_id
		})
		a.setAttribute(MY_MARK, '')
	})
}).observe(window.document, { childList: true, subtree: true, attributeFilter: ['href'] })

/* monkey patch WebSocket */

const my_sockets = []
const super_WebSocket = window.WebSocket

window.WebSocket = function() {
	const sock = new super_WebSocket(...arguments)
	my_sockets.push(sock)
	return sock
}

window.WebSocket.prototype = super_WebSocket.prototype


/* util for generating json data (to be put into to binary format) */

// generate epoch_id
// `variance` adds some tiny difference between each call so that calling
// the function many times in short period results in unique epoch_ids
let variance = 0
const epoch_id = () => Math.floor(Date.now() * (4194304 + (variance = (variance + 0.1) % 5)))

// note: i did a bit more experimenting and found that
// the json for sending a text message (not just sticker)
// is almost exactly the same, so i just decided to add
// a generalisation right then and there..

// info used by both sticker and text message
const to_thread = thread_id =>
	({ source: 65537
	 , thread_id
	 , otid: `${epoch_id()}`
	})

// info used by sticker message
const p_sticker = sticker_id => thread_id =>
	({ ...to_thread(thread_id)
	 , send_type: 2
	 , sticker_id
	})

// info used by text message
const p_text = text => thread_id =>
	({ ...to_thread(thread_id)
	 , send_type: 1
	 , text
	})

// info used to send stuff to a thread
// :: str -> (str -> json) -> json
const pp_treq = thread_id => payload =>
	({ version_id: '4148577245264481' // important set value
	 , tasks:
		[ { label: '46'  // important set value
		  , task_id: 123 // id itself doesnt seem to matter, but field in general must have some value it seems
		  , payload: JSON.stringify(payload(thread_id))
		  , queue_name: `${thread_id}`
		  , failure_count: null // unimportant prob; i took it out and still worked
		  }
		]
	 , epoch_id: epoch_id()
	 , data_trace_id: null // unimportant prob; i took it out and still worked
	})

// info used to send anything to facebook
const ppp_req = payload =>
	({ request_id: 123 // id itself doesnt seem to matter, but field in general must have some value it seems
	 , type: 3         // important set value
	 , payload: JSON.stringify(payload)
	 , app_id: '2220391788200892' // important set value
	})

/* util for generating binary data (to send down WebSocket) */

// variable length int encoding
const vlen = x => new Array(Math.ceil(x.toString(2).length / 7)).fill(0)
	.map((_, i, ar) => ((x >> i*7) & 0x7f) + (i === ar.length - 1 ? 0 : 0x80))

const ls_req = new TextEncoder().encode('/ls_req')

// wraps a ppp_req (into mqtt binary format)
const b_ppp_req = payload => {
	console.log(payload)
	const b_payload = new TextEncoder().encode(JSON.stringify(payload))
	return new Uint8Array(
		[ 0x32
		, ...vlen(2 + 7 + 2 + b_payload.length)
		, 0x00, ls_req.length, ...ls_req
		, 0x00, 0x0a // msg id
		, ...b_payload
		]
	)
}

const b_f = funp => (thread_id, ...rest) => b_ppp_req(ppp_req(pp_treq(thread_id)(funp(...rest))))
const b_sticker = b_f(p_sticker)
const b_text = b_f(p_text)