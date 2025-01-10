// Uncaught Exception 핸들러
process.on('uncaughtException', (error) => {
  console.error('Unhandled Exception:', error);
  // 필요한 경우 로깅 또는 추가 작업 수행
});

const express = require('express');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const app = express();
const xlsx = require("xlsx");
const axios = require("axios");
const PORT = 3000;
const { GoogleGenerativeAI } = require("@google/generative-ai");
const KEYWORDS = ["주의사항",'식품유형',"소비기한","제조연월일",'제공고시','영양정보','원재료명','제조원','원재료','원산지','제품정보','상품정보','원료', '함량', "표시대상", "알레르기","표시사항"];
const MAX_IMAGE_SIZE_MB = 5 // 허용할 최대 이미지 크기 (MB)
// 서버 시작
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


//####################################################################

// JSON 파일 읽기 함수
const readJsonFile = (filePath) => {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

// 특정 문구를 찾는 함수
const extractTextFromImage = async (imageUrl) => {
  try {
    const { data } = await Tesseract.recognize(imageUrl, 'kor',{tessedit_char_blacklist: "!@#$^&"});

		return data.text.trim(); // 추출된 텍스트 반환

  } catch (error) {
    console.log('extractTextFromImage error :',error); // 오류 발생 시 빈 문자열 반환
		return "";
  }
};

// 이미지 URL 유효성 검사 함수
const isValidImageUrl = async (imageUrl) => {
  try {
    const response = await fetch(imageUrl, { method: 'HEAD' }); // 헤더만 요청
    return response.ok; // 상태 코드가 200-299 범위인지 확인
  } catch {
    return false; // 네트워크 오류 등으로 요청 실패 시 false 반환
  }
};

//신규 데이터 확인
const isNewData = (crawlData, dbData) => {
	return crawlData.filter(v => !dbData.find(i =>  i.CLCT_SNO === v.CLCT_SNO ) );
}


// 정규식: 괄호 이전 부분만 추출
const extractOrigin = (origin) => {
  return origin.replace(/\s*\(.*?\)$/, "").trim();
};

//일치여부 확인
const getMatchInfo = (originInfo, data) => {
  if (!originInfo || !data || data.length === 0) return "U"; // 원산지 정보가 없을 때
  
	let originName = extractOrigin(originInfo);

	if(originName === "국산"){ originName = "국내산"}
	
	const originList = data.map((v) => {
		if(v.origin === "국산"){v.origin = "국내산"}
		return v;
	});
	
	console.log('originName :',originName);
	console.log('비교데이터 목록 :',originList);
	

  // 모든 원산지 정보를 확인하여 하나라도 일치하지 않으면 "N" 반환
  const allMatch = originList.every((v) => v.origin === originName);

  if (allMatch) return "Y"; // 모든 원산지가 일치할 때
  if (!allMatch) return "N"; // 하나라도 불일치할 때
  return "E"; 
}



// 이미지 크기 확인 함수
const getImageSize = async (imageUrl) => {
  try {
    const response = await axios.head(imageUrl);
    const contentLength = response.headers["content-length"];
    return contentLength ? parseInt(contentLength, 10) / (1024 * 1024) : 0; // 바이트를 MB로 변환
  } catch (error) {
    console.error(`이미지 크기 확인 중 오류 발생: ${error.message}`);
    return -1; // 오류 발생 시 -1 반환
  }
};

// Tesseract OCR 처리 함수
const tesseractOCR = async (originLinkArray) => {
  const filteredArr = [];
  const keywords = KEYWORDS;

  try {

    const imageProcessingPromises = originLinkArray.map(async (imageUrl) => {
			
      try {
        // 이미지 URL 유효성 검사
        const validUrl = await isValidImageUrl(imageUrl);
        
				if (!validUrl) {
          console.warn(`유효하지 않은 이미지 URL: ${imageUrl}`);
          return null; // 유효하지 않으면 처리하지 않음
        }

        // 이미지 크기 확인
        const imageSize = await getImageSize(imageUrl);
        
				if (imageSize === -1 || imageSize > MAX_IMAGE_SIZE_MB) {
          console.warn(`이미지 크기 초과 또는 확인 실패: ${imageUrl} (${imageSize.toFixed(2)} MB)`);
          return null; // 크기 초과 시 제외
        }

        // 크기가 적합한 이미지에 대해서만 텍스트 추출
        const extractedText = await extractTextFromImage(imageUrl);
				console.log('################################################################################');
        console.log("추출 이미지 링크",imageUrl);
				console.log('################################################################################');
        console.log("추출된 텍스트:", extractedText);
				console.log('###############################################################################');
        // 키워드가 포함된 경우 링크 추가
        if (keywords.some((keyword) => extractedText.includes(keyword))) {
          return imageUrl;
        }
        return null;
      } catch (error) {
        console.error(`이미지 처리 중 오류 발생: ${imageUrl} - ${error.message}`);
        return null; // 오류 발생 시 null 반환
      }
    });

    // 병렬로 이미지 처리
    const results = await Promise.all(imageProcessingPromises);

    // 유효한 이미지 링크만 필터링
    filteredArr.push(...results.filter((result) => result));
  } catch (error) {
    console.error(`이미지 필터링 중 오류 발생: ${error.message}`);
  }

  return filteredArr;
};

const api_clova = async (param, data) => {
  const secretKey = "aG9WckV3cXRKQUFCYkRCcWZEZmxxclVyYXZSYkZSaUY=";
  const apiUrl ="https://q94sb7hfbg.apigw.ntruss.com/custom/v1/35242/ce552f91e9dc79133d2c327dcc006de9fe02e1411e44d1a012f5e9451c0a34c2/general";
  const requestBody = {
    images: [{ format: "png", name: "medium", data: null, url: `${param}`,}],
    lang: "ko",
    requestId: "string",
    resultType: "string",
    timestamp: 0,
    version: "V1",
  };

  const headers = { "Content-Type": "application/json", "X-OCR-SECRET": secretKey };

  try {
    const response = await axios.post(apiUrl, requestBody, { headers });
    
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

		fs.appendFile("error.log", JSON.stringify(errorLog, null, 2) + "\n", (err) => { if (err) {console.error("Failed to write to log file", err);}

    });

    // 에러를 던지는 대신 null 또는 기본 값을 반환
    console.error("OCR API 호출 중 에러가 발생했습니다:", error.message);
    return null; // 기본값으로 반환
  }
};


//제미나이 api
const api_gemini = async (param) => {

  const genAI = new GoogleGenerativeAI("AIzaSyDJ5kF961JPdsNZMGGpAOGTXbXwS62F4XA");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = `
    ${param}
    이 데이터에서 원산지 정보와 추가정보를 JSON 형식으로 변환할 수 있게 { 원산지정보, 상세정보 } 모양으로 만들어서 출력해줘.
    -'원산지정보'의 모양은 원산지정보:[{itemNm, origin}...] 형식. 데이터가 없을경우에도 모양은 유지해주고, 정보가 없을시 공백처리.
		- '국산', '국내', '국내산' 등 키워드일경우 '국내산'으로 일치시켜줘
		- '국내산 한우', '국내산 돈육' 등 키워드에서 돈육, 한우 등은 제외해줘. 오로지 '원산지' 만 표시해줘
    - '상세정보'의 모양은 서술형으로 적되, 원재료(원료) 및 함량정보만, html 문에 영향을 줄 수 있는 텍스트는 제외하고 1줄로 서술할것
    - object의 depth는 1depth로 유지
		- 바로 사용할 수 있도록 JSON.stringfy 된 모습으로 출력할것. Markdown문법을 사용한 응답하지말것
		- 원산지정보, 상세정보가 없더라도 모양을만들어서 빈데이터로라도 전달할것
		- 상품정보가 여러개라도 1개 원산지정보와 상세설명에 서술하여 형식을 깨지 말것
  `;
  const result = await model.generateContent(prompt);

  // 응답 텍스트를 가져오기
  let responseText = result.response.text();

  let convertText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

	return JSON.parse(convertText);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 데이터 변환 함수
const convertData = async (crawlData, dbData) => {
  const newData = isNewData(crawlData, dbData);

  if (!newData || newData.length === 0) {
    return [];
  }

  const result = [];

  for (const v of newData) {
    try {
      let images = v.IMG_URL;
      let textInfo = v.PRDT_EXPLN_CN || "";
      let originInfo = v.PLOR_NM;

      // 이미지 URL이 문자열일 경우 배열로 변환
			const fixedUrlList = [
				"https://shop-phinf.pstatic.net/20240314_215/1710406075637zWoCJ_JPEG/240104_%ED%94%84%EB%A0%88%EC%8B%9C%EC%A7%80_%EC%8A%A4%EB%A7%88%ED%8A%B8%EC%8A%A4%ED%86%A0%EC%96%B4_intro3.jpg",
				"https://shop-phinf.pstatic.net/20240314_31/17104060851745Voa7_JPEG/240301_%EB%B0%B0%EC%86%A1%EC%95%88%EB%82%B4.jpg"
		];
		
		if (images && typeof images === "string") {
				const imageArray = images
						.split("§")
						.map((url) => url.trim())
						.map((url) => url.replace(/\?type=w860$/, ''))
						.map((url) => url.replace(/\?type=wg860$/, ''))
						.filter((url) => url !== "")  // 빈 문자열 제외
						.filter((url) => !url.toLowerCase().endsWith('.gif')) // .gif 확장자 제외
						.filter((url) => !fixedUrlList.includes(url)); // fixedUrlList에 있는 URL 제외

				console.log('1차 OCR 진행 목록 :',imageArray);

        // Tesseract OCR 호출
        images = await tesseractOCR(imageArray);

        console.log("테서렉트 추출 이미지 목록:", images);

				if(images.length === 0){
					const errorLog = {
						timestamp: new Date().toISOString(),
						itemData:JSON.stringify(v),
					};

					fs.appendFile("추출실패목록.log", JSON.stringify(errorLog+",", null, 2) + "\n", (err) => { if (err) {console.error("Failed to write to log file", err);}});
				}
      } else {
        images = [];
      }

			// Clova OCR 호출 (순차적 처리)
			let clovaTexts = [];
			for (const image of images) {
				const clovaText = await api_clova(image, v);
				clovaTexts.push(clovaText);
			}
			textInfo += clovaTexts.join(" ");

      console.log("클로바 정제 텍스트:", textInfo);

      // Gemini 호출
      const geminiData = await api_gemini(textInfo);
      console.log("Gemini 정제 데이터:", geminiData);

      v.PLOR_MTCH_YN = getMatchInfo(originInfo, geminiData.원산지정보);
      v.PRDT_EXPLN_CN = geminiData.상세정보;

      // IMG_URL 삭제
      delete v.IMG_URL;

      result.push(v);

      // 요청 간 딜레이 추가
      await delay(100); // 100ms 대기
    } catch (error) {
      console.error("Error processing item:", v, error);
    }
  }

  return result;
};

// JSON 파일 쓰기 함수
const writeJsonFile = async (fileName, data) => {
  try {
    const filePath = `${__dirname}/${fileName}.json`;
    const jsonData = JSON.stringify(data, null, 2); // 데이터를 JSON 문자열로 변환 (들여쓰기 2)
    
    // 'utf-8'을 encoding으로 직접 전달
    await fs.promises.writeFile(filePath, jsonData, 'utf-8');
    console.log(`JSON 파일이 저장되었습니다: ${filePath}`);
  } catch (error) {
    console.error(`JSON 파일 저장 중 오류 발생: ${error.message}`);
  }
};

// 비동기 실행
(async () => {
	const startTime = Date.now(); // 시작 시간 기록
	const request = {data : readJsonFile("crawlData.json") }
  const crawlData = request.data;
	const dbData = readJsonFile("test_db.json");
  const result = await convertData(crawlData, dbData);

  console.log("최종 결과 :", result);

	const endTime = Date.now(); // 종료 시간 기록
  console.log(`함수 실행 시간: ${endTime - startTime}ms`);

	dbData.push(...result);
	
	if(result.length > 0){
		await writeJsonFile("newData",result);//신규데이터파일 저장
		await writeJsonFile("test_db",dbData);//전체데이터 파일 저장
	} else {
		console.log('신규 데이터가 없습니다');
	}
})();
