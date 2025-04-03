// Uncaught Exception 핸들러
process.on('uncaughtException', (error) => { console.error('Unhandled Exception:', error)});

//라이브러리
const express = require('express');
const axios = require("axios");
const app = express();
const fs = require('fs');
const Tesseract = require('tesseract.js');

//설정
const PORT = 9030;
const KEYWORDS = ["주의사항",'식품유형',"소비기한","제조연월일",'제공고시','영양정보','원재료명','제조원','원재료','원산지','제품정보','상품정보','원료', '함량', "표시대상", "알레르기","표시사항"];
const MAX_IMAGE_SIZE_MB = 5 // 허용할 최대 이미지 크기 (MB)

//GEMINI
const GEMINI_API_KEY = "AIzaSyBj9gyBjHijN1gm0ba1xB9mqFqauFgK0xY"; // 👉 여기에 실제 API 키 입력
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

//CLOVA
const CLOVA_KEY = "c2tMbUpTRGhUTU9GdU9BVnp6QXVWZHZTSHRlZVlBc1g=";
const CLOVA_URL ="https://8y0qqcpvdb.apigw.ntruss.com/custom/v1/38160/1090f4750f02daca6643ae269c1f06e77a7c6af0468477fdf164e58d9b65382e/general";

// 엔드포인트
app.post('/ocr/searchProductOrigin', async (req, res) => {
	
	ocrProcess(req.body);

	res.status(200).json({status:"OK", message:"전달완료"})
});


//*********** util ************//
// JSON 파일 읽기
const readJsonFile = (filePath) => { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) };

// JSON 파일 쓰기 
const writeJsonFile = async (filePath, data) => {
  try {
    const jsonData = JSON.stringify(data, null, 2); // 데이터를 JSON 문자열로 변환 (들여쓰기 2)
    
    // 'utf-8'을 encoding으로 직접 전달
    await fs.promises.writeFile(filePath, jsonData, 'utf-8');
    console.log(`JSON 파일이 저장되었습니다: ${filePath}`);
  } catch (error) {
    console.error(`JSON 파일 저장 중 오류 발생: ${error.message}`);
  }
};


//이미지 검사
const checkImage = async (imageUrl) => {
  
	try {
    const response = await axios.head(imageUrl);
    const contentLength = response.headers["content-length"];
    const imageSize = contentLength ? parseInt(contentLength, 10) / (1024 * 1024) : 0; // 바이트를 MB로 변환

    // 상태 코드가 200-299 범위이고, 이미지 크기가 MAX_IMAGE_SIZE_MB 이하일 경우 true 반환
    if (response.status >= 200 && response.status < 300 && imageSize <= MAX_IMAGE_SIZE_MB) { return true }
    
    return false;
  
	} catch (error) {
    console.log('이미지 확인중 에러:', error);
    return false;
  }

};

//신규 데이터 확인
const isNewData = (crawlData, dbData, requestData) => {

	//신규데이터 필터링링
	const newData = crawlData.filter(v => !dbData.find(i =>  i.CLCT_SNO === v.CLCT_SNO ) );
	
	//request데이터 필터링
	const addData = crawlData.filter(v => requestData.find(i =>  i.CLCT_SNO === v.CLCT_SNO ) );

	return [...newData, ...addData];
}

//이미지 링크 배열 변환
const convertLinkImages = (data) => {
	
	//공통 미사용 이미지 리스트
	const exceptUrlList = [
			"https://shop-phinf.pstatic.net/20240314_215/1710406075637zWoCJ_JPEG/240104_%ED%94%84%EB%A0%88%EC%8B%9C%EC%A7%80_%EC%8A%A4%EB%A7%88%ED%8A%B8%EC%8A%A4%ED%86%A0%EC%96%B4_intro3.jpg",
			"https://shop-phinf.pstatic.net/20240314_31/17104060851745Voa7_JPEG/240301_%EB%B0%B0%EC%86%A1%EC%95%88%EB%82%B4.jpg"
	];

	const result = data
	.split("§")
	.map((url) => url.trim())
	.map((url) => url.replace(/\?type=w860$/, ''))
	.map((url) => url.replace(/\?type=wg860$/, ''))
	.filter((url) => url !== "")  // 빈 문자열 제외
	.filter((url) => !url.toLowerCase().endsWith('.gif')) // .gif 확장자 제외
	.filter((url) => !exceptUrlList.includes(url));

	return result;
}

//0.1초 지연을 위한 함수
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


//*********** tesseract ************//
// 특정 텍스트 추출
const extractText = async (imageUrl) => {
  try {
		// console.log('### 테서렉트 OCR 진행 : ',imageUrl)
    
		const res = await Tesseract.recognize(imageUrl, 'kor',{tessedit_char_blacklist: "!@#$^&"});
		const result = res.data.text.trim();

		// console.log('### 테서렉트 OCR 완료 : ',result);
		return result;

  } catch (error) {
    console.log('extractText 오류 :',error);
		return "";
  }
};

// 개별 이미지 처리
const processImage = async (imageUrl) => {
  try {
    // 이미지 URL 유효성 검사
    const validURL = await checkImage(imageUrl);
    if (!validURL) return null;

    // 텍스트 추출
    const extractedText = await extractText(imageUrl);

    // 키워드가 포함된 경우 링크 추가
    return KEYWORDS.some((v) => extractedText.includes(v)) ? imageUrl : null;
  } catch (error) {
    console.error(`이미지 처리 중 오류 발생: ${imageUrl} - ${error.message}`);
    return null;
  }
};

// OCR 처리
const tesseractOCR = async (originLinkArray) => {
  
	const filteredArr = [];

  try {
    const imageProcessingPromises = originLinkArray.map(processImage);

    // 병렬로 이미지 처리
    const results = await Promise.all(imageProcessingPromises);

    // 유효한 이미지 링크만 필터링
    filteredArr.push(...results.filter((result) => result));
  
	} catch (error) {
    console.error(`이미지 필터링 중 오류 발생: ${error.message}`);
  }

  return filteredArr;
};

//*********** CLOVA ************//
const api_clova = async (param, data) => {
  
  const requestBody = {
    images: [{ format: "png", name: "medium", data: null, url: `${param}`,}],
    lang: "ko",
    requestId: "string",
    resultType: "string",
    timestamp: 0,
    version: "V1",
  };

  const headers = { "Content-Type": "application/json", "X-OCR-SECRET": CLOVA_KEY };

  try {
    const response = await axios.post(CLOVA_URL, requestBody, { headers });
    
		let ocrText = "";

    response.data.images[0].fields.forEach((v) => (ocrText += v.inferText));
		
    return ocrText;

  } catch (error) {

    const errorLog = {
      timestamp: new Date().toISOString(),
			data:data,
			errorImgLink:param,
      message: error.message,
      stack: error.stack,
    };

		fs.appendFile("error.log", JSON.stringify(errorLog, null, 2) + "\n", (err) => { if (err) {console.error("에러로그파일 작성 실패", err);}

    });

    console.error("OCR API 호출 중 에러가 발생했습니다:", error.message);
    return null; // 기본값으로 반환
  }
};

//*********** GEMINI ************//
const api_gemini = async (param, originInfo) => {

	if(param.length === 0) { return { 원산지정보:[], 상세정보:"상세정보 없음" } }

	// console.log('###### 제미나이 전달 클로바 OCR 완료 텍스트:',param); //디버깅용
	// console.log('###### 제미나이 전달 원산지 정보:',originInfo); //디버깅용

	const prompt = `
	요약할 데이터 '${param}'
	비교할 데이터 '${originInfo}'

	- 요약할데이터를 JSON 형식 ' {"원산지정보":[], "상세정보":String, "일치여부":String }' 형태로 가공해줘. 모든 key와 value는 필수로 존재해야해.
	- '원산지정보'의 value는 {itemNm, origin} 의 형식을가진 객체로 이루어진 배열.
	- itemNm은 재료명, origin은 원산지.
	- origin이 '국산', '국내', '국내산' 등 키워드일경우 '국내산'으로 치환.
	- 키워드에서 원산지가 아닌 다른 텍스트는 제외하고 원산지만 표시할것(국내산 돼지, 국내산 배추 등에서 국내산만 표시).
	- '요약할 데이터'와 '비교할 데이터'를 비교하여 원산지 표기 일치여부를 판단하여 '일치여부' 에 추가. 
	- 정확한 텍스트의 일치를 확인하는것이 아닌 맥락상 데이터간 원산지 표기국가가 들어맞는지를 판단해야함. 
	- 여러개의 원산지 데이터 중 하나라도 일치하지 않으면 불일치로 판단. 
	- 국산과 국내산은 같은 원산지임. 같은 국가 내 지역이 다른것은 일치로 판단.
	- '일치여부'의 값은 일치 : Y, 불일치 : N로 표시하며, '요약할 데이터'와 '비교할 데이터'중 하나라도 누락되거나 판단이 어려울시 : U 로 표기.
	- '상세정보'의 value는 서술형 텍스트, 원재료 및 함량정보를 표기한다. 가능할 경우 원산지도 함께 표기하며 이 외의 정보는 넣지 않는다.
	- html 문에 영향을 줄 수 있는 텍스트는 제외하고 공백없이 1줄로 서술.
	- 각 Obeject의 depth는 1depth로 제한.
	- JSON.stringfy 된 형태로 출력.
	- Markdown문법을 사용한 응답 금지.
	- 상품정보가 여러개라도 1개 원산지정보와 상세설명에 서술하여 형식을 깨지 말것
	-  모든 key와 value는 데이터가 없더라도 필수로 완성시킬것. 
	- 데이터가 없을경우 빈배열과 빈 문자열을 value로 반환.
	`;

	try {
    const response = await axios.post( GEMINI_URL, { contents: [ { parts: [{ text:prompt }]} ]}, { headers: { "Content-Type": "application/json"}} );

		// 응답 텍스트 변환
		let res = response.data.candidates[0].content.parts;

	// JSON 문자열 추출
	const jsonString = res[0].text.match(/```json\n([\s\S]*?)```/)[1].trim();

	// JSON 파싱
	const parsedData = JSON.parse(jsonString);

	return parsedData;

  } catch (error) {
    console.error("❌ API 호출 오류:", error.response ? error.response.data : error.message);
  }
};

// 데이터 변환 함수
const convertData = async (crawlData, dbData, requestData) => {

	const {  productId, item_clsf_nm, dlng_prc_amt, ntsl_bzenty_addr, ntsl_bzenty_nm, prdt_nm, prdt_expln_cn, lnk_url, img_url, plor_nm, reg_dt } = crawlData;

	const crawlConverted = {
		CLCT_SNO : productId,
		ITEM_CLSF_NM : item_clsf_nm,
		DLNG_PRC_AMT : dlng_prc_amt,
		NTSL_BZENTY_ADDR : ntsl_bzenty_addr,
		NTSL_BZENTY_NM : ntsl_bzenty_nm,
		PRDT_NM : prdt_nm,
		IMG_URL : img_url,
		LNK_URL : lnk_url,
		REG_DT : reg_dt,
		PRDT_EXPLN_CN : prdt_expln_cn,
		PLOR_NM : plor_nm
	}

	//크롤링데이터, 기존 누적 DB데이터, 재수집 요청데이터 필터링하여 반환
  const newData = isNewData(crawlConverted, dbData, requestData);
	
  if (!newData || newData.length === 0) { return []; }

  const result = [];

  for (const v of newData) {
    try {
      let images		 = v.IMG_URL;
      let textInfo 		= v.PRDT_EXPLN_CN || "";
      let originInfo = v.PLOR_NM;

		// 이미지 URL이 문자열일 경우 배열로 변환하여 테서렉트 정제
		if (images && typeof images === "string") {
				const imageArray = convertLinkImages(images);

        // Tesseract OCR 호출
        images = await tesseractOCR(imageArray);

        // console.log("테서렉트 추출 이미지 목록:", images);

				if (images.length === 0) {

					const errorLog = { timestamp: new Date().toISOString(), itemData: JSON.stringify(v)};

					fs.appendFile("추출실패목록.log",JSON.stringify(errorLog, null, 2) + ",\n",
							(err) => {if (err) {console.error("Failed to write to log file", err);}}
					);
				}
      } else { images = []; }

			// Clova OCR 호출 (순차적 처리)
			let clovaTexts = [];

			for (const image of images) { const clovaResult = await api_clova(image, v); clovaTexts.push(clovaResult); }

			textInfo += clovaTexts.join(" ");

      // Gemini 호출
      const geminiData = await api_gemini(textInfo, originInfo);
      
			// console.log("Gemini 정제 데이터:", geminiData);

      v.PLOR_MTCH_YN = geminiData.일치여부 || "U";
      v.PRDT_EXPLN_CN = geminiData.상세정보;
			// v.GEMINI = geminiData;
			
			if(!v.PLOR_NM){ v.PLOR_NM = "정보없음" }

      // IMG_URL 삭제
      delete v.IMG_URL;

      result.push(v);

      // 요청 간 딜레이 추가
      await delay(100); 

    } catch (error) {
      console.error("Error processing item:", v, error);
    }
  }

  return result;
};


const ocrProcess = async (resData = []) => {
	const crawlData = resData; // 크롤링 데이터(수집기 전달)
	const requestData = readJsonFile("/home/epis/ocr_update_req.json");					 // 재수집 요청 데이터
	const dbData = readJsonFile("/home/epis/ocr_db.json"); 																// 현재까지 누적되어 있는 데이터
	const convertedData = await convertData(crawlData, dbData, requestData); // 정제된 데이터

	// 신규 데이터와 요청 데이터 분리
	const requestKeys = requestData.map(item => item.CLCT_SNO); // 재수집 요청했던 key들
	const insertData = []; // insert할 데이터

	// 신규 데이터 필터링
	const newData = convertedData.filter(item => 
			!dbData.some(existingItem => existingItem.CLCT_SNO === item.CLCT_SNO)
	);

	// 업데이트 데이터 필터링
	const updatedData = convertedData.filter(item => 
			requestKeys.includes(item.CLCT_SNO) && 
			dbData.some(existingItem => existingItem.CLCT_SNO === item.CLCT_SNO)
	);

	// 기존 데이터에 업데이트 적용
	updatedData.forEach(updateItem => {
			const index = dbData.findIndex(existingItem => existingItem.CLCT_SNO === updateItem.CLCT_SNO);
			if (index !== -1) {
					dbData[index] = { ...dbData[index], ...updateItem }; // 기존 데이터 교체
			}
	});

	// 신규 데이터 삽입
	insertData.push(...newData);
	dbData.push(...insertData); // 누적 데이터에 정제된 신규 데이터를 추가

	if (insertData.length > 0 || updatedData.length > 0) {
			await writeJsonFile("/home/epis/ocr_db.json", dbData); // 전체 데이터 파일 (누적)
			await writeJsonFile("/home/epis/ocr_insert_db.json", insertData); // 인서트할 데이터 파일 (신규)
			await writeJsonFile("/home/epis/ocr_update_db.json", updatedData); // 업데이트할 데이터 파일 (기존 것 수정)
	} else {
			console.log('신규 데이터가 없습니다');
	}
};

//서버실행
(async () => {
	app.listen(PORT, () => { console.log(`OCR NODE Server is running on http://localhost:${PORT}`)});
})();