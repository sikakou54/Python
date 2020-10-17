document.addEventListener('DOMContentLoaded', () => {
	const socket = window.io();    
	let userType = document.getElementById('play_input_type').textContent;
	let roomID = document.getElementById('play_input_roomID').textContent;
	let user_name = document.getElementById('play_input_user_name').textContent;
	let rtcPeerConnection = null;

	socket.on('connect', async () => {
		/* 初期化処理 */
		socket.emit('init', roomID, user_name );

		/** ストリームを取得し通信を始める */
		startVideo();
	});

	socket.on('req_join_room', async ( text ) => {
		addLog(text);
	});

	socket.on('req_leave_room', async ( text ) => {
		/** 相手が退室したらリモートのビデオ要素を初期化する */
		const remotevideo = document.getElementById("remote_video");
		remotevideo.srcObject = null;

		addLog(text);
	});

	socket.on('message', async ( message ) => {

		// 別の人が Start するとココに入ってくる
		let parsedEvent;

		console.log('message :', message );

		try {
			parsedEvent = JSON.parse( message );
		}
		catch( error ) {
			return console.warn('on message : Failed To Parse', error);
		}

		if( !rtcPeerConnection ) {
			return
		}

		// トップレベルプロパティは sdp か candidate のみ
		try {

			if( parsedEvent.sdp ) {
				// sdp プロパティ配下は type: 'offer' or 'answer' と sdp プロパティ
				await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription( parsedEvent.sdp ));

				// FIXME : iOS Safari が後から来た接続を受け取った時 (type: 'offer') に以下のエラーが出る
				//         InvalidStateError: description type incompatible with current signaling state
				//         iOS Safari が後から接続すれば正常に接続できる。回避策が分からない
				if( parsedEvent.sdp.type === 'offer' ) {
					// type: 'answer' 時に createAnswer() すると以下のエラーが出るので type: 'offer' のみにする
					// Failed to execute 'createAnswer' on 'RTCPeerConnection': PeerConnection cannot create an answer in a state other than have-remote-offer or have-local-pranswer.
					const answer = await rtcPeerConnection.createAnswer();
					await rtcPeerConnection.setLocalDescription(answer);

					// Socket を経由して Answer SDP を送る (送る内容は Offer SDP と同じ)
					socket.emit('message', JSON.stringify({ sdp: rtcPeerConnection.localDescription }));
				}
				else {
					console.log('on message : SDP Answer (Do Nothing)', parsedEvent );
				}
			}
			else if(parsedEvent.candidate) {
				// candidate プロパティ配下は candidate・sdpMid・sdpMLineIndex プロパティ
				rtcPeerConnection.addIceCandidate(new RTCIceCandidate(parsedEvent.candidate));
			}
			else {
				console.log('on message : Other (Do Nothing)', parsedEvent);  // 基本ない
			}
		}
		catch(error) {
			console.warn('on message : Unexpected Error', error, parsedEvent);  // 基本ない
		}

	});

	async function startVideo() {

		try {
			const stream = await getUserMedia();
			const myvideo = document.getElementById('myvideo');

			myvideo.srcObject = stream;

			createRtcPeerConnection(stream);

			const sessionDescription = await rtcPeerConnection.createOffer();
			await rtcPeerConnection.setLocalDescription(sessionDescription);

			// Socket を経由して Offer SDP を送る
			socket.emit('message', JSON.stringify({ sdp: rtcPeerConnection.localDescription }));
		}
		catch(error) {
			console.warn('Failed To Start', error);
		}

	}

	/** ビデオを開始する・例外ハンドリングは呼び出し元の #start-button のクリックイベントで行う */
	async function getUserMedia() {
		
		/** カメラストリームを取得 */
		const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

		return stream;
	}

	/** getUserMedia() で取得した Stream をセットした RTCPeerConnection を作成する・例外ハンドリングは呼び出し元の #start-button のクリックイベントで行う */
	function createRtcPeerConnection( stream ) {

		if(rtcPeerConnection) {
			return;
		}

		// iOS Safari の場合 Member RTCIceServer.urls is required and must be an instance of (DOMString or sequence) エラーが出るので
		// url ではなく urls を使う : https://github.com/shiguredo/momo/pull/48
		rtcPeerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
		rtcPeerConnection.onicecandidate = onicecandidate;

		if( stream != null ) {
			// Chrome などは RTCPeerConnection.addStream(localStream) が動作するが iOS Safari は動作しないので addTrack() を使う
			// iOS Safari : https://stackoverflow.com/questions/57106846/uncaught-typeerror-peerconnection-addstream-is-not-a-function/57108963
			stream.getTracks().forEach((track) => {
				rtcPeerConnection.addTrack(track, stream);
			});
		}

		// iOS Safari では onaddstream が動作しないので ontrack を使用する (Chrome なども ontrack に対応)
		rtcPeerConnection.ontrack = ontrack;

		// onremovestream は相手の接続が切れたり再接続されたりした時に発火するが、onaddstream (ontrack) 後に onremovestream が動作して
		// おかしくなることが多いので何もしないことにする (removetrack も定義しない)
	}
      
	/** ICE Candidate を送る */
	function onicecandidate(event) {
		if(event.candidate) {
			socket.emit('message', JSON.stringify({ candidate: event.candidate }) );
		}
		else {
			console.log('onicecandidate : End', event);
		}
	}

	/** 相手の接続を受け取ったらリモート映像として表示する */
	function ontrack(event) {

		try {
			const remotevideo = document.getElementById("remote_video");
			if( remotevideo.srcObject == null ) {
				remotevideo.srcObject = event.streams[0];
			}
		}
		catch(error) {
			// Windows Chrome だと play() can only be initialized by a user gesture. エラーが発生して再生できない場合がある
			// chrome://flags#enable-webrtc-remote-event-log を有効にすると play() できるようになる
			console.warn('Failed To Play Remote Video', error);
		}

	}

	function addLog( contents ) {
		let element_log = document.getElementById('play_room_log');
		let element_contents = document.createElement('li');
		element_contents.textContent = contents;
		element_log.appendChild(element_contents);
	}

});
