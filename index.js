const express = require('express');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const app = express();
const xlsx = require("xlsx");
const axios = require("axios");
const PORT = 3000;
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
    const { data } = await Tesseract.recognize(imageUrl, 'kor');
    
		return data.text.trim(); // 추출된 텍스트 반환

  } catch (error) {
    return ''; // 오류 발생 시 빈 문자열 반환
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

// 여러 이미지 링크를 처리하고, 특정 키워드 중 하나라도 포함된 이미지 링크만 필터링하는 함수
const filterImagesByKeywords = async (originLinkArray, keywords) => {
  const filteredArr = [];

  try {
    // 여러 이미지를 병렬로 처리
    const imageProcessingPromises = originLinkArray.map(async (imageUrl) => {
      try {
        // 이미지 URL 유효성 검사
        if (!(await isValidImageUrl(imageUrl))) {
          console.warn(`유효하지 않은 이미지 URL: ${imageUrl}`);
          return null; // 유효하지 않으면 null 반환
        }

        // 이미지에서 텍스트 추출
        const extractedText = await extractTextFromImage(imageUrl);

				console.log('=============================================================================');
				console.log('##추출시작####################################################################');
				console.log('=============================================================================');
				console.log(extractedText)
				console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
				console.log('###############################추출종료######################################');
				console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
        // 키워드 중 하나라도 포함된 경우 해당 링크를 filteredArr에 추가
        if (keywords.some((keyword) => extractedText.includes(keyword))) {
          return imageUrl;
        }
				return null;
      } catch (error) {
        console.error(`이미지 처리 중 오류 발생: ${imageUrl} - ${error.message}`);
      }
    });

    // 모든 이미지 처리 결과를 병렬로 실행하고 결과를 기다림
    const results = await Promise.all(imageProcessingPromises);

    // null이 아닌 유효한 이미지 링크만 필터링
    filteredArr.push(...results.filter((result) => result));
  } catch (error) {
    console.error(`이미지 필터링 중 오류 발생: ${error.message}`);
  }

  return filteredArr;
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
  if (!originInfo || !data) return "U"; // 원산지 정보가 없을 때
  
	const originName = extractOrigin(originInfo);

  // 모든 원산지 정보를 확인하여 하나라도 일치하지 않으면 "N" 반환
  const allMatch = data.every((v) => v.origin === originName);

  if (allMatch) return "Y"; // 모든 원산지가 일치할 때
  if (!allMatch) return "N"; // 하나라도 불일치할 때
  return "E"; 
}

//테서렉트 OCR
const tesseractOCR = async (data) => {
	const keywords = ["주의사항",'식품유형',"소비기한","제조연월일",'제공고시','영양정보','원재료명','제조원','원재료','원산지','제품정보','상품정보','원료', '함량', "표시대상", "알레르기","표시사항"];
	
	return await filterImagesByKeywords(data, keywords);
};

//클로바 OCR API
const api_clova = async (param) => {
	const secretKey = "aG9WckV3cXRKQUFCYkRCcWZEZmxxclVyYXZSYkZSaUY=";
	const apiUrl = "https://q94sb7hfbg.apigw.ntruss.com/custom/v1/35242/ce552f91e9dc79133d2c327dcc006de9fe02e1411e44d1a012f5e9451c0a34c2/general"
	const requestBody = {
    "images": [
      {
        "format": "png",
        "name": "medium",
        "data": null,
        "url": `${param}`
      }
    ],
    "lang": "ko",
    "requestId": "string",
    "resultType": "string",
    "timestamp": 0,
    "version": "V1"
	}

	const headers = { 'Content-Type': 'application/json', 'X-OCR-SECRET': secretKey }
	const response = await axios.post(apiUrl, requestBody, { headers });
	
	let ocrText = "";
	
	response.data.images[0].fields.forEach(v => ocrText += v.inferText);

	return ocrText;
}

//제미나이 api
const api_gemini = async (param) => {

  const genAI = new GoogleGenerativeAI("AIzaSyDJ5kF961JPdsNZMGGpAOGTXbXwS62F4XA");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = `
    ${param}
    이 데이터에서 원산지 정보와 추가정보를 JSON 형식으로 변환할 수 있게 { 원산지정보, 상세정보 } 모양으로 만들어서 출력해줘.
    -'원산지정보'의 모양은 원산지정보:[{itemNm:"쌀", origin:"외국산"}...] 형식.
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
      let textInfo = v.PRDR_EXPLN_CN || "";
      let originInfo = v.PRDT_CN;

      // 이미지 URL이 문자열일 경우 배열로 변환
      if (images && typeof images === "string") {
        const imageArray = images.split("§").map((url) => url.trim()).map(url => url.replace(/\?type=w860$/, ''));

				console.log('origin Images :',imageArray);
        // Tesseract OCR 호출
        images = await tesseractOCR(imageArray);
        console.log("Filtered Images (Tesseract):", images);
      } else {
        images = [];
      }

			// Clova OCR 호출 (순차적 처리)
			// let clovaTexts = [];
			// for (const image of images) {
			// 	const clovaText = await api_clova(image);
			// 	clovaTexts.push(clovaText);
			// }
			// textInfo += clovaTexts.join(" ");

      // console.log("Clova OCR Results:", textInfo);

      // // Gemini 호출
      // const geminiData = await api_gemini(textInfo);
      // console.log("Gemini Result:", geminiData);

      // v.MATCH = getMatchInfo(originInfo, geminiData.원산지정보);
      // v.PRDR_EXPLN_CN = geminiData.상세정보;

      // // IMG_URL 삭제
      // delete v.IMG_URL;

      // result.push(v);

      // // 요청 간 딜레이 추가
      // await delay(100); // 100ms 대기
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
  const newData = readJsonFile("ocrNewData.json");
	const dbData = readJsonFile("ocrDB.json");
  const result = await convertData(newData, dbData);

  // console.log("최종 결과 :", result);

	// dbData.push(...result);
	
	// await writeJsonFile("ocrNewData",result);//신규데이터파일 저장
	// await writeJsonFile("ocrDB",dbData);//전체데이터 파일 저장
})();
