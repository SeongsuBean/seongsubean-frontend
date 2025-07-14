import {rootUrl,common,loadLayout} from '/common/common.js';
import { menuApi } from './common/menuApi.js';
import { cafeApi } from './common/cafeApi.js';

document.addEventListener("DOMContentLoaded", () => {
  loadLayout(); // ✅ header/footer 삽입
});
// 즉시 실행 함수로 스코프 격리
(callback => {
  let retryCount = 0;
  const MAX_RETRIES = 50; // 최대 5초 대기 (100ms * 50)

  // Kakao Maps API 로드 확인 함수
  function isKakaoMapsReady() {
    return typeof kakao !== 'undefined' &&
        kakao.maps &&
        kakao.maps.Map &&
        kakao.maps.services &&
        kakao.maps.services.Geocoder;
  }

  // Kakao Maps API 로드 대기 후 실행
  function initKakaoMap() {
    if (!isKakaoMapsReady()) {
      console.error('Kakao Maps API가 완전히 로드되지 않았습니다.');
      return false;
    }

    try {
      console.log('initMap called');

      // 2. Kakao 지도 생성 (중심 좌표 및 줌 레벨 설정)
      const mapContainer = document.getElementById('map');
      if (!mapContainer) {
        console.error('지도 컨테이너를 찾을 수 없습니다.');
        return false;
      }

      const mapOption = {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 6,
        draggable: false,
        zoomable: false
      };
      const map = new kakao.maps.Map(mapContainer, mapOption);

      // 2-1) Geocoder 인스턴스 생성 (주소 → 좌표 변환)
      // 어떤 방식으로든 줌 레벨이 바뀌지 않습니다.
      map.setMinLevel(5);
      map.setMaxLevel(5);
      const geocoder = new kakao.maps.services.Geocoder();

      // ✅ 현재 열린 InfoWindow를 추적하는 변수 추가
      let currentInfoWindow = null;

      // 3. SeongsuBean 일러스트 및 커스텀 마커 삽입 (index.js 통합 부분)
      geocoder.addressSearch('서울특별시 성동구 성수일로 56', (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
          const coords = new kakao.maps.LatLng(result[0].y, result[0].x);

          // 커스텀 오버레이 (빈 오버레이)
          const beanOverlay = new kakao.maps.CustomOverlay({
            position: coords,
            yAnchor: 1,
            zIndex: 2
          });
          beanOverlay.setMap(map);

          // 지도 중심 이동
          map.setCenter(coords);

          // 일러스트 오버레이
          const illustration = new kakao.maps.CustomOverlay({
            position: coords,
            content: '<img src="/images/common/SeongsuBean.png" width="1248" height="510" style="pointer-events: none;">',
            xAnchor: 0.5,
            yAnchor: 0.5,
            zIndex: 0
          });
          illustration.setMap(map);
        } else {
          console.warn('일러스트 실패:', status);
        }
      });

      // ───────────────────────────────────────────────────────────────────
      // ① Top5 가져오기 + 마커 추가
      function fetchTop5() {
        common.get('/api/search/top5')
        .then(res => {
          const list = res.data;
          clearMarkers();
          list.forEach((item) => {
            // item이 {addr, cafeId} 형태인지 {address, cafeId} 형태인지 확인
            if (item.addr) {
              // 기존 형태: {addr: '주소', cafeId: 123}
              addMarkerByAddress(item.addr, item.cafeId);
            } else if (item.address) {
              // 새로운 형태: {address: '주소', cafeId: 123}
              addMarkerByAddress(item);
            } else {
              console.warn('알 수 없는 데이터 형태:', item);
            }
          });
        })
        .catch(console.error);
      }

      const crownBtn = document.getElementById('crownBtn');
      if (crownBtn) {
        crownBtn.addEventListener('click', fetchTop5);
      }

      // 아이콘 클릭 리스너
      document.querySelectorAll('#filterIcons .filter-icon-img')
      .forEach(img => {
        img.addEventListener('click', () => {
          const menuName = img.dataset.menu;
          clearMarkers();
          fetchCafeAddresses(menuName);
        });
      });

      // 4. 지도에 표시된 마커 객체들을 저장할 배열
      let markers = [];

      // 마커 전체 삭제
      function clearMarkers() {
        // ✅ 기존 InfoWindow도 함께 닫기
        if (currentInfoWindow) {
          currentInfoWindow.close();
          currentInfoWindow = null;
        }

        markers.forEach(m => m.setMap(null));
        markers = [];
      }

      function showCafeInfoWindow(cafeId, marker, position) {
        if (currentInfoWindow) currentInfoWindow.close();

        cafeApi.get(`/${cafeId}`)
        .then(async res => {
          // ▶ 여기서 res.data 가 ResponseCafe 전체
          const cafe = res.data;

          // (이미지 로드 등 동일)
          let imageUrl = '/images/common/default.png';
          if (cafe.mainImage) {
            try {
              const imgRes = await common.get(
                  `/api/common${cafe.mainImage}`,
                  { responseType: 'blob' }
              );
              imageUrl = URL.createObjectURL(imgRes.data);
            } catch {}
          }

          const content = `
        <div style="padding:10px;width:250px;">
          <img src="${imageUrl}" style="width:100%;height:120px;object-fit:cover;" alt=""/>
          <h4>${cafe.cafeName}</h4>
          <p>${cafe.fullAddress}</p>
          <p>${cafe.callNumber}</p>
          <button onclick="window.location.href='/cafe/cafe-detail.html?cafeId=${cafeId}'">
            상세보기
          </button>
        </div>`;

          const infoWindow = new kakao.maps.InfoWindow({ content, position });
          infoWindow.open(map, marker);
          currentInfoWindow = infoWindow;
        })
        .catch(err => console.error('카페 정보 로딩 실패', err));
      }


      // ✅ 수정된 addMarkerByAddress 함수 - 객체 형태 주소 데이터 처리
      function addMarkerByAddress(addressData, cafeId = null) {
        // addressData가 객체인지 문자열인지 확인
        let address;
        let actualCafeId = cafeId;

        if (typeof addressData === 'object' && addressData.address) {
          // 객체 형태: {address: '주소', cafeId: 123}
          address = addressData.address;
          actualCafeId = addressData.cafeId || cafeId;
        } else if (typeof addressData === 'string') {
          // 문자열 형태: '주소'
          address = addressData;
        } else {
          console.warn('유효하지 않은 주소 데이터:', addressData);
          return;
        }

        console.log('[addMarkerByAddress] 검색:', address, 'cafeId:', actualCafeId);

        // 주소 유효성 검사
        if (!address || address.trim() === '') {
          console.warn('빈 주소:', address);
          return;
        }

        geocoder.addressSearch(address, (result, status) => {
          console.log('Geocoder 결과:', status, result);

          if (status === kakao.maps.services.Status.OK && result[0]) {
            const {y: lat, x: lng} = result[0];
            const pos = new kakao.maps.LatLng(lat, lng);

            const marker = new kakao.maps.Marker({
              map: map,
              position: pos
            });

            console.log('마커 생성 완료:', address);

            // actualCafeId가 있을 때만 클릭 이벤트 추가
            if (actualCafeId) {
              kakao.maps.event.addListener(marker, 'click', () => {
                showCafeInfoWindow(actualCafeId, marker, pos);
              });
            }

            markers.push(marker);
          } else {
            console.error('주소 검색 실패:', address, '상태:', status);
          }
        });
      }


      /**
       * 메뉴명(menuName)으로 cafeId 리스트를 받아
       * 각 ID별 카페 상세를 조회한 뒤
       * 주소에 마커를 찍는 함수
       */
      async function fetchCafeAddresses(menuName) {
        console.log('[fetchCafeAddresses] 메뉴:', menuName);
        // 1) 메뉴 백엔드에서 cafeId 배열 조회
        const {data: cafeIds} = await menuApi.get(
            '/category',
            {params: {menuCategory: menuName}}
        );

        if (!Array.isArray(cafeIds) || cafeIds.length === 0) {
          alert('해당 카테고리의 카페가 없습니다.');
          return;
        }
        clearMarkers();

        for (const id of cafeIds) {
          try {
            const { data: cafe } = await cafeApi.get(`/${id}`);
            // 완전한 주소를 직접 조합
            const fullAddr = `${cafe.cafeAddress} ${cafe.cafeDetailAddress}`;

            addMarkerByAddress({
              address: fullAddr,
              cafeId: cafe.cafeId
            });
          } catch (err) {
            console.warn(`❌ [${id}] 카페 정보 로딩 실패, 건너뜁니다.`);
          }
        }
      }

// 메뉴 아이콘에 클릭 리스너 연결
      document
      .querySelectorAll('#filterIcons .filter-icon-img')
      .forEach(img => {
        img.addEventListener('click', () => {
          fetchCafeAddresses(img.dataset.menu);
        });
      });






      // ───────────────────────────────────────────────────────────────────
      /*
       * 키워드로 통합 검색 → 주소 리스트 반환 → 카카오 지오코딩 → 마커 표시
       */
      // ✅ 수정된 searchByKeyword 함수
      function searchByKeyword(keyword) {
        console.log('[searchByKeyword] 요청 키워드:', keyword);
        axios.get(`/api/search?keyword=${encodeURIComponent(keyword)}`)
        .then(res => {
          const addressList = res.data;
          console.log('[searchByKeyword] 받은 데이터:', addressList);
          if (!Array.isArray(addressList) || addressList.length === 0) {
            alert('검색 결과가 없습니다.');
            return;
          }
          clearMarkers();

          addressList.forEach(item => {
            addMarkerByAddress(item);
          });
        })
        .catch(err => {
          console.error('[searchByKeyword] 에러:', err);
          alert('검색 중 오류가 발생했습니다.');
        });
      }

      // 7. 검색창 이벤트 핸들러
      const input = document.getElementById('searchInput');
      const searchbtn = document.getElementById('searchBtn');

      if (searchbtn) {
        searchbtn.addEventListener('click', () => {
          const keyword = input.value.trim();
          if (keyword) {
            searchByKeyword(keyword);
          }
        });
      }

      if (input) {
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const keyword = input.value.trim();
            if (keyword) {
              searchByKeyword(keyword);
            }
          }
        });
      }

      // ✅ 지도 클릭 시 InfoWindow 닫기 추가
      kakao.maps.event.addListener(map, 'click', () => {
        if (currentInfoWindow) {
          currentInfoWindow.close();
          currentInfoWindow = null;
        }
      });

      // 8. 카페 등록 버튼 클릭 시 이동
      // ✅ JWT 토큰 가져오기
      const token = localStorage.getItem('auth');
      const registerBtn = document.getElementById('cafe-registration');

      // ✅ 버튼이 존재할 경우 토큰 여부에 따라 보이기/숨기기 결정
      if (registerBtn) {
        if (!token) {
          registerBtn.style.display = 'none';
        } else {
          registerBtn.style.display = 'block'; // 명시적으로 표시
          registerBtn.addEventListener('click', () => {
            window.location.href = 'cafe/cafe-registration.html';
          });
        }
      }

      console.log('Kakao Maps 초기화 완료');
      return true;

    } catch (error) {
      console.error('지도 초기화 중 오류:', error);
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // 카드 뷰 로직 (Kakao Maps와 독립적으로 실행)

  async function fetchCafeImages(cafes) {
    return await Promise.all(cafes.map(async (cafe) => {
      if (!cafe.mainImage) {
        return '/images/cafe/menuDefault.png'; // 기본 이미지
      }

      const imageUrl = rootUrl + `/api/common${cafe.mainImage}`;

      try {
        const res = await axios.get(imageUrl, { responseType: 'blob' });
        return URL.createObjectURL(res.data);
      } catch (err) {
        console.warn(`이미지 불러오기 실패: ${cafe.mainImage}`, err);
        return '/images/board/free/menuDefault.png';
      }
    }));
  }


  function initKakaoMapWithRetry() {
    console.log(
        `Kakao Maps API 로드 확인 중... (시도 ${retryCount + 1}/${MAX_RETRIES})`);
    console.log('kakao 객체 존재:', typeof kakao !== 'undefined');
    console.log('kakao.maps 존재:', typeof kakao !== 'undefined' && kakao.maps);

    if (isKakaoMapsReady()) {
      console.log('Kakao Maps API 로드 완료, 지도 초기화 시작');
      const success = initKakaoMap();
      if (success) {
        console.log('지도 초기화 성공');
        return;
      }
    }

    retryCount++;
    if (retryCount >= MAX_RETRIES) {
      console.error('Kakao Maps API 로드 실패: 최대 재시도 횟수 초과');
      alert('지도를 로드할 수 없습니다. 페이지를 새로고침해주세요.');
      return;
    }

    // 100ms 후 다시 시도
    setTimeout(initKakaoMapWithRetry, 100);
  }


  function initCardView() {
    const wrapper = document.getElementById('cards-wrapper');
    const btn = document.getElementById('load-more');
    let currentPage = 1;

    if (!wrapper || !btn) {
      console.error('카드 뷰 요소를 찾을 수 없습니다.');
      return;
    }

    async function renderRow() {
      try {
        const res = await axios.get(`${rootUrl}/api/main/cards?page=${currentPage}`);
        const cafes = res.data;

        if (!Array.isArray(cafes) || cafes.length === 0) {
          btn.style.display = 'none';
          return;
        }

        const imageUrls = await fetchCafeImages(cafes);
        cafes.forEach((cafe, idx) => {
          cafe.resolvedImageUrl = imageUrls[idx];
        });

        const row = document.createElement('div');
        row.className = 'card-row';

        cafes.forEach(cafe => {
          const card = document.createElement('div');
          card.className = 'card';
          card.dataset.cafeId = cafe.cafeId;
          card.innerHTML = `
          <img src="${cafe.resolvedImageUrl}" alt="${cafe.cafeName}">
          <div class="info">
            <h4>${cafe.cafeName}</h4>
            <p>${cafe.introduction || ''}</p>
          </div>
        `;

          card.addEventListener('click', () => {
            window.location.href = `../cafe/cafe-detail.html?cafeId=${cafe.cafeId}`;
          });

          row.appendChild(card);
        });

        wrapper.appendChild(row);

        if (cafes.length < 4) {
          btn.style.display = 'none';
        }

        currentPage += 1;

      } catch (err) {
        console.error('카페 카드 로딩 실패:', err);
        btn.style.display = 'none';
      }
    }

    renderRow();
    btn.addEventListener('click', renderRow);
  }


  // DOMContentLoaded 이벤트에서 초기화 시작
  function init() {
    console.log('init() 호출됨 - DOM 상태:', document.readyState);

    // 카드 뷰는 즉시 초기화
    initCardView();

    // Kakao Maps API 초기화 (재시도 로직 포함)
    initKakaoMapWithRetry();
  }

  // DOM 로딩 완료를 확실히 보장
  function waitForDOM() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      // 이미 로드된 경우 약간의 지연 후 실행
      setTimeout(init, 50);
    }
  }

  // 초기화 시작
  waitForDOM();

})(); // IIFE 끝